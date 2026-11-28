'use strict';

const http = require('node:http');
const { expect } = require('chai');
const OTPAuth = require('otpauth');
const {
    callHyperBackup,
    callSynology,
    createSynologyClient,
    normalizeSynologyError,
    resolveApiVersion,
    toBuffer,
    waitForFreshTotpCode
} = require('../build/lib/synologyClient.js');

const secret = 'JBSWY3DPEHPK3PXP';

async function withNas(handler, run) {
    const requests = [];
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', async () => {
            const params = new URLSearchParams(Buffer.concat(chunks).toString());
            const entry = Object.fromEntries(params.entries());
            requests.push(entry);
            try {
                const result = await handler(entry, requests.length);
                response.writeHead(result.status || 200, {
                    'content-type': result.contentType || 'application/json'
                });
                response.end(result.body === undefined
                    ? JSON.stringify({ success: true, data: { sid: `sid-${requests.length}` } })
                    : result.body);
            } catch (error) {
                response.destroy(error);
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
        await run(`http://127.0.0.1:${address.port}`, requests);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

function makeClient(url, twoFactorEnabled = false, twoFactorSecret, sleep = async () => undefined) {
    const address = new URL(url);
    return createSynologyClient({
        account: 'test-user',
        passwd: 'test-password',
        host: address.hostname,
        port: Number(address.port),
        protocol: 'http',
        apiVersion: '7.2',
        ignoreCertificateErrors: false,
        twoFactorEnabled,
        twoFactorSecret,
        sleep
    });
}

function loginRequests(requests) {
    return requests.filter(request => request.api === 'SYNO.API.Auth');
}

describe('synologyClient with syno@3.2.0', () => {
    it('logs in without sending an OTP when 2FA is disabled', async () => {
        await withNas(async entry => ({
            body: entry.api === 'SYNO.API.Auth'
                ? JSON.stringify({ success: true, data: { sid: 'sid-one' } })
                : JSON.stringify({ success: true, data: { model: 'NAS' } })
        }), async (url, requests) => {
            const handle = makeClient(url);
            try {
                await callSynology(handle.client, 'dsm', 'getInfo');
                expect(loginRequests(requests)).to.have.length(1);
                expect(loginRequests(requests)[0]).not.to.have.property('otp_code');
                expect(requests[1]._sid).to.equal('sid-one');
            } finally {
                await handle.close();
            }
        });
    });

    it('generates a fresh TOTP for logins to multiple stations', async () => {
        await withNas(async entry => ({
            body: entry.api === 'SYNO.API.Auth'
                ? JSON.stringify({ success: true, data: { sid: `sid-${entry.session}` } })
                : JSON.stringify({ success: true, data: { ok: true } })
        }), async (url, requests) => {
            const originalNow = Date.now;
            const firstTimestamp = 1_800_000_000_000;
            const handle = makeClient(url, true, secret);
            try {
                Date.now = () => firstTimestamp;
                await callSynology(handle.client, 'dsm', 'getInfo');
                Date.now = () => firstTimestamp + 30_000;
                await callSynology(handle.client, 'fs', 'getInfo');
                const codes = loginRequests(requests).map(request => request.otp_code);
                const totp = new OTPAuth.TOTP({ secret });
                expect(codes).to.deep.equal([
                    totp.generate({ timestamp: firstTimestamp }),
                    totp.generate({ timestamp: firstTimestamp + 30_000 })
                ]);
                expect(codes[0]).not.to.equal(codes[1]);
            } finally {
                Date.now = originalNow;
                await handle.close();
            }
        });
    });

    it('serializes two-factor logins and waits after a code has been accepted', async () => {
        let notifyFirstLogin;
        const firstLoginStarted = new Promise(resolve => {
            notifyFirstLogin = resolve;
        });
        let releaseFirstLogin;
        const firstLoginGate = new Promise(resolve => {
            releaseFirstLogin = resolve;
        });
        await withNas(async (entry, requestNumber) => {
            if (entry.api === 'SYNO.API.Auth' && requestNumber === 1) {
                notifyFirstLogin();
                await firstLoginGate;
            }
            return {
                body: JSON.stringify({
                    success: true,
                    data: entry.api === 'SYNO.API.Auth' ? { sid: `sid-${entry.session}` } : { ok: true }
                })
            };
        }, async (url, requests) => {
            const originalNow = Date.now;
            let currentTime = 1_800_000_000_000;
            const sleepDelays = [];
            const handle = makeClient(url, true, secret, async milliseconds => {
                sleepDelays.push(milliseconds);
                currentTime += milliseconds;
            });
            Date.now = () => currentTime;
            try {
                const firstRequest = callSynology(handle.client, 'dsm', 'getInfo');
                await firstLoginStarted;
                const secondRequest = callSynology(handle.client, 'fs', 'getInfo');
                releaseFirstLogin();
                await Promise.all([firstRequest, secondRequest]);

                const authRequests = loginRequests(requests);
                expect(authRequests.map(request => request.session)).to.deep.equal([
                    'DiskStationManager',
                    'FileStation'
                ]);
                expect(authRequests[0].otp_code).not.to.equal(authRequests[1].otp_code);
                expect(sleepDelays).to.have.length(1);
                expect(authRequests[1].otp_code).to.equal(
                    new OTPAuth.TOTP({ secret }).generate({ timestamp: currentTime })
                );
            } finally {
                releaseFirstLogin();
                Date.now = originalNow;
                await handle.close();
            }
        });
    });

    it('retries a rejected two-factor code once with a fresh code', async () => {
        let loginCount = 0;
        let currentTime = 1_800_000_000_000;
        const sleepDelays = [];
        await withNas(async entry => {
            if (entry.api === 'SYNO.API.Auth' && ++loginCount === 1) {
                return { body: JSON.stringify({ success: false, error: { code: 404 } }) };
            }
            return {
                body: JSON.stringify({
                    success: true,
                    data: entry.api === 'SYNO.API.Auth' ? { sid: 'retry-sid' } : { ok: true }
                })
            };
        }, async (url, requests) => {
            const originalNow = Date.now;
            Date.now = () => currentTime;
            const handle = makeClient(url, true, secret, async milliseconds => {
                sleepDelays.push(milliseconds);
                currentTime += milliseconds;
            });
            try {
                await callSynology(handle.client, 'dsm', 'getInfo');
                const codes = loginRequests(requests).map(request => request.otp_code);
                expect(codes).to.have.length(2);
                expect(codes[0]).not.to.equal(codes[1]);
                expect(sleepDelays).to.have.length(1);
            } finally {
                Date.now = originalNow;
                await handle.close();
            }
        });
    });

    it('allows one fresh-code retry for each independent station login', async () => {
        const loginCounts = new Map();
        let currentTime = 1_800_000_000_000;
        const sleepDelays = [];
        await withNas(async entry => {
            if (entry.api === 'SYNO.API.Auth') {
                const count = (loginCounts.get(entry.session) || 0) + 1;
                loginCounts.set(entry.session, count);
                if (count === 1) {
                    return { body: JSON.stringify({ success: false, error: { code: 404 } }) };
                }
            }
            return {
                body: JSON.stringify({
                    success: true,
                    data: entry.api === 'SYNO.API.Auth' ? { sid: `sid-${entry.session}` } : { ok: true }
                })
            };
        }, async (url, requests) => {
            const originalNow = Date.now;
            Date.now = () => currentTime;
            const handle = makeClient(url, true, secret, async milliseconds => {
                sleepDelays.push(milliseconds);
                currentTime += milliseconds;
            });
            try {
                await callSynology(handle.client, 'dsm', 'getInfo');
                currentTime += 30_000;
                await callSynology(handle.client, 'fs', 'getInfo');
                const authRequests = loginRequests(requests);
                expect(authRequests.map(request => request.session)).to.deep.equal([
                    'DiskStationManager',
                    'DiskStationManager',
                    'FileStation',
                    'FileStation'
                ]);
                expect(authRequests[0].otp_code).not.to.equal(authRequests[1].otp_code);
                expect(authRequests[2].otp_code).not.to.equal(authRequests[3].otp_code);
                expect(sleepDelays).to.have.length(2);
            } finally {
                Date.now = originalNow;
                await handle.close();
            }
        });
    });

    it('reports a second rejected two-factor code without retrying again', async () => {
        let loginCount = 0;
        let currentTime = 1_800_000_000_000;
        const sleepDelays = [];
        await withNas(async entry => {
            if (entry.api === 'SYNO.API.Auth' && ++loginCount <= 2) {
                return { body: JSON.stringify({ success: false, error: { code: 404 } }) };
            }
            return {
                body: JSON.stringify({
                    success: true,
                    data: entry.api === 'SYNO.API.Auth' ? { sid: 'retry-sid' } : { ok: true }
                })
            };
        }, async (url, requests) => {
            const originalNow = Date.now;
            Date.now = () => currentTime;
            const handle = makeClient(url, true, secret, async milliseconds => {
                sleepDelays.push(milliseconds);
                currentTime += milliseconds;
            });
            try {
                let failure;
                try {
                    await callSynology(handle.client, 'dsm', 'getInfo');
                } catch (error) {
                    failure = error;
                }
                expect(failure).to.have.property('authenticationError', true);
                expect(failure).to.have.property('code', 404);
                expect(failure.message).to.include('rejected the two-factor authentication code');
                expect(loginRequests(requests)).to.have.length(2);
                expect(loginRequests(requests)[0].otp_code).not.to.equal(
                    loginRequests(requests)[1].otp_code
                );
                expect(sleepDelays).to.have.length(1);
            } finally {
                Date.now = originalNow;
                await handle.close();
            }
        });
    });

    it('waits for a new TOTP code before reusing an already accepted code', async () => {
        let currentCode = 'first-code';
        const totp = {
            generate: () => currentCode,
            remaining: () => 100
        };
        const code = await waitForFreshTotpCode(totp, 'first-code', async milliseconds => {
            expect(milliseconds).to.equal(125);
            currentCode = 'next-code';
        });
        expect(code).to.equal('next-code');
    });

    it('reuses the Core session for repeated Hyper Backup requests', async () => {
        await withNas(async entry => ({
            body: JSON.stringify({
                success: true,
                data: entry.api === 'SYNO.API.Auth' ? { sid: 'core-sid' } : { task_list: [] }
            })
        }), async (url, requests) => {
            const handle = makeClient(url, true, secret);
            try {
                await callHyperBackup(handle.client, 'list');
                await callHyperBackup(handle.client, 'status', { id: '3' });
                expect(loginRequests(requests)).to.have.length(1);
                expect(requests.filter(request => request.api !== 'SYNO.API.Auth')
                    .map(request => request._sid)).to.deep.equal(['core-sid', 'core-sid']);
            } finally {
                await handle.close();
            }
        });
    });

    it('generates the RFC 6238 TOTP from the configured Base32 secret', async () => {
        await withNas(async entry => ({
            body: entry.api === 'SYNO.API.Auth'
                ? JSON.stringify({ success: true, data: { sid: 'rfc-sid' } })
                : JSON.stringify({ success: true, data: { ok: true } })
        }), async (url, requests) => {
            const originalNow = Date.now;
            const handle = makeClient(url, true, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
            try {
                Date.now = () => 59_000;
                await callSynology(handle.client, 'dsm', 'getInfo');
                expect(loginRequests(requests)[0].otp_code).to.equal('287082');
            } finally {
                Date.now = originalNow;
                await handle.close();
            }
        });
    });

    it('shares a single in-flight login between concurrent requests to one station', async () => {
        await withNas(async entry => {
            if (entry.api === 'SYNO.API.Auth') {
                await new Promise(resolve => setTimeout(resolve, 25));
                return { body: JSON.stringify({ success: true, data: { sid: 'shared-sid' } }) };
            }
            return { body: JSON.stringify({ success: true, data: { ok: true } }) };
        }, async (url, requests) => {
            const handle = makeClient(url, true, secret);
            try {
                await Promise.all([
                    callSynology(handle.client, 'dsm', 'getInfo'),
                    callSynology(handle.client, 'dsm', 'getSystemStatus')
                ]);
                expect(loginRequests(requests)).to.have.length(1);
                expect(requests.filter(request => request.api !== 'SYNO.API.Auth'))
                    .to.have.length(2);
                expect(requests.filter(request => request._sid).map(request => request._sid))
                    .to.deep.equal(['shared-sid', 'shared-sid']);
            } finally {
                await handle.close();
            }
        });
    });

    it('reports incorrect credentials and rejected TOTP without replaying an API call', async () => {
        for (const [code, expected] of [[400, 'authentication failed'], [403, 'two-factor'], [404, 'two-factor']]) {
            await withNas(async () => ({
                body: JSON.stringify({
                    success: false,
                    error: { code }
                })
            }), async (url, requests) => {
                const twoFactorEnabled = code !== 400;
                const originalNow = Date.now;
                let currentTime = 1_800_000_000_000;
                Date.now = () => currentTime;
                const handle = makeClient(
                    url,
                    twoFactorEnabled,
                    twoFactorEnabled ? secret : undefined,
                    async milliseconds => {
                        currentTime += milliseconds;
                    }
                );
                try {
                    let failure;
                    try {
                        await callSynology(handle.client, 'dl', 'createTask', { uri: 'magnet:?xt=test' });
                    } catch (error) {
                        failure = error;
                    }
                    expect(failure.message).to.include(expected);
                    expect(failure.authenticationError).to.equal(true);
                    const authRequests = loginRequests(requests);
                    expect(authRequests).to.have.length(code === 404 ? 2 : 1);
                    if (code === 404) {
                        expect(authRequests[0].otp_code).not.to.equal(authRequests[1].otp_code);
                    }
                    expect(requests.filter(request => request.api !== 'SYNO.API.Auth'))
                        .to.have.length(0);
                } finally {
                    Date.now = originalNow;
                    await handle.close();
                }
            });
        }
    });

    it('does not classify a station API 404 as a two-factor authentication error', async () => {
        await withNas(async entry => ({
            body: JSON.stringify(entry.api === 'SYNO.API.Auth'
                ? { success: true, data: { sid: 'valid-session' } }
                : { success: false, error: { code: 404 } })
        }), async (url, requests) => {
            const handle = makeClient(url, true, secret);
            try {
                let failure;
                try {
                    await callSynology(handle.client, 'dsm', 'getInfo');
                } catch (error) {
                    failure = error;
                }
                expect(failure).to.have.property('code', 404);
                expect(failure).to.have.property('authenticationError', false);
                expect(failure.message).not.to.include('two-factor');
                expect(loginRequests(requests)).to.have.length(1);
                expect(requests.filter(request => request.api !== 'SYNO.API.Auth'))
                    .to.have.length(1);
            } finally {
                await handle.close();
            }
        });
    });

    it('rejects enabled 2FA with missing or malformed secrets before network access', () => {
        for (const twoFactorSecret of [undefined, 'not-a-base32-key!']) {
            expect(() => createSynologyClient({
                account: 'test-user',
                passwd: 'test-password',
                host: '127.0.0.1',
                port: 5001,
                protocol: 'https',
                apiVersion: '7.2',
                ignoreCertificateErrors: true,
                twoFactorEnabled: true,
                twoFactorSecret
            })).to.throw(/secret is (missing|not valid Base32)/);
        }
    });

    it('reuses one station SID and does not repeat a failed command after session expiry', async () => {
        for (const expirationCode of [106, 107]) {
            let stationCalls = 0;
            await withNas(async entry => {
                if (entry.api === 'SYNO.API.Auth') {
                    return { body: JSON.stringify({ success: true, data: { sid: `sid-${stationCalls}` } }) };
                }
                stationCalls++;
                if (stationCalls === 1) {
                    return { body: JSON.stringify({ success: false, error: { code: expirationCode } }) };
                }
                return { body: JSON.stringify({ success: true, data: { ok: true } }) };
            }, async (url, requests) => {
                const handle = makeClient(url);
                try {
                    let failed;
                    try {
                        await callSynology(handle.client, 'dsm', 'getInfo');
                    } catch (error) {
                        failed = error;
                    }
                    expect(failed).to.have.property('code', expirationCode);
                    expect(stationCalls).to.equal(1);
                    expect(handle.client.sessions.DiskStationManager).to.equal(undefined);
                    await callSynology(handle.client, 'dsm', 'getInfo');
                    await callSynology(handle.client, 'dsm', 'getInfo');
                    expect(loginRequests(requests)).to.have.length(2);
                    expect(requests.filter(request => request.api !== 'SYNO.API.Auth')).to.have.length(3);
                    expect(requests[3]._sid).to.equal(requests[4]._sid);
                } finally {
                    await handle.close();
                }
            });
        }
    });

    it('uses compatibility aliases accepted by the released definitions', async () => {
        await withNas(async entry => ({
            body: JSON.stringify({ success: true, data: { method: entry.method } })
        }), async (url, requests) => {
            const handle = makeClient(url);
            try {
                await callSynology(handle.client, 'fs', 'Clear_invalidSharing');
                await callSynology(handle.client, 'dtv', 'GetInfoTuner');
                expect(requests.map(request => request.method)).to.include('clear_invalid');
                expect(requests.map(request => request.method)).to.include('getinfo');
            } finally {
                await handle.close();
            }
        });
    });

    it('maps saved API settings only to published definition versions', () => {
        expect(resolveApiVersion('7.x.x')).to.equal('7.2');
        expect(resolveApiVersion('6.2.3')).to.equal('6.2.2');
        expect(resolveApiVersion('6.2')).to.equal('6.2.2');
        expect(() => resolveApiVersion('5.2')).to.throw('DSM 5 is no longer supported');
        expect(() => resolveApiVersion('8.0')).to.throw('not supported by syno@3.2.0');
    });

    it('normalizes Buffer, ArrayBuffer and typed array media responses', () => {
        const bytes = Uint8Array.from([1, 2, 3]);
        expect(toBuffer(Buffer.from([1, 2, 3]))).to.deep.equal(Buffer.from([1, 2, 3]));
        expect(toBuffer(bytes.buffer)).to.deep.equal(Buffer.from([1, 2, 3]));
        expect(toBuffer(bytes.subarray(1))).to.deep.equal(Buffer.from([2, 3]));
        expect(toBuffer({ data: 'not binary' })).to.equal(undefined);
    });

    it('keeps TLS changes local to this client and closes its dispatcher', async () => {
        const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        await withNas(async () => ({ body: JSON.stringify({ success: true, data: {} }) }), async url => {
            const handle = makeClient(url);
            try {
                expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).to.equal(originalTlsSetting);
                await callSynology(handle.client, 'dsm', 'getInfo');
            } finally {
                await handle.close();
            }
        });
        expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).to.equal(originalTlsSetting);
    });

    it('preserves API and network error codes in normalized errors', () => {
        const apiError = normalizeSynologyError(Object.assign(new Error('Session timeout'), { code: 106 }));
        const networkError = normalizeSynologyError(Object.assign(new Error('fetch failed'), {
            cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
        }));
        expect(apiError).to.have.property('code', 106);
        expect(apiError.message).to.include('session expired');
        expect(networkError).to.have.property('causeCode', 'ECONNRESET');
    });
});
