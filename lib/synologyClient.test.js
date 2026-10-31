'use strict';

const http = require('node:http');
const { expect } = require('chai');
const OTPAuth = require('otpauth');
const {
    callSynology,
    createSynologyClient,
    normalizeSynologyError,
    resolveApiVersion,
    toBuffer
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

function makeClient(url, twoFactorEnabled = false, twoFactorSecret) {
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
        twoFactorSecret
    });
}

function loginRequests(requests) {
    return requests.filter(request => request.api === 'SYNO.API.Auth');
}

describe('synologyClient with syno@3.1.0', () => {
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
            const handle = makeClient(url);
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
        for (const [code, expected] of [[400, 'authentication failed'], [404, 'two-factor']]) {
            await withNas(async entry => ({
                body: JSON.stringify({
                    success: false,
                    error: { code }
                })
            }), async (url, requests) => {
                const handle = makeClient(url, code === 404, code === 404 ? secret : undefined);
                try {
                    let failure;
                    try {
                        await callSynology(handle.client, 'dl', 'createTask', { uri: 'magnet:?xt=test' });
                    } catch (error) {
                        failure = error;
                    }
                    expect(failure.message).to.include(expected);
                    expect(failure.authenticationError).to.equal(true);
                    expect(loginRequests(requests)).to.have.length(1);
                    expect(requests.filter(request => request.api !== 'SYNO.API.Auth'))
                        .to.have.length(0);
                } finally {
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
        let stationCalls = 0;
        await withNas(async entry => {
            if (entry.api === 'SYNO.API.Auth') {
                return { body: JSON.stringify({ success: true, data: { sid: `sid-${loginRequests([]).length + stationCalls}` } }) };
            }
            stationCalls++;
            if (stationCalls === 1) {
                return { body: JSON.stringify({ success: false, error: { code: 106 } }) };
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
                expect(failed).to.have.property('code', 106);
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
        expect(() => resolveApiVersion('8.0')).to.throw('not supported by syno@3.1.0');
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