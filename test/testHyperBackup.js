const assert = require('node:assert/strict');
const {
    getHyperBackupTaskList,
    fetchHyperBackupTaskStatus,
    hasRecognizedHyperBackupStatus,
    HYPER_BACKUP_STATUS_ADDITIONAL,
    hyperBackupTaskChannelId,
    mapHyperBackupTasks,
    normalizeHyperBackupObjectId,
    parseHyperBackupTaskList,
    planStaleHyperBackupChannels,
    planStaleHyperBackupStates,
    projectHyperBackupTaskStates,
    HYPER_BACKUP_TASK_STATE_NAMES,
} = require('../build/lib/hyperBackup.js');
const { callHyperBackup } = require('../build/lib/synologyClient.js');

describe('Hyper Backup task mapping', () => {
    it('calls the DSM API through the authenticated Synology client', async () => {
        let loginSession;
        let requestUrl;
        let requestOptions;
        const client = {
            protocol: 'https',
            host: 'nas.local',
            port: 5001,
            auth: {
                login: async (sessionName) => {
                    loginSession = sessionName;
                    return { sid: 'session-id' };
                },
                syno: {
                    request: async (url, options) => {
                        requestUrl = url;
                        requestOptions = options;
                        return {
                            ok: true,
                            json: async () => ({ success: true, data: { task_id: 12 } }),
                        };
                    },
                },
            },
        };

        const requests = [];
        client.auth.syno.request = async (url, options) => {
            requestUrl = url;
            requestOptions = options;
            requests.push(Object.fromEntries(options.body));
            return {
                ok: true,
                json: async () => ({ success: true, data: { task_id: 12 } }),
            };
        };

        const liveResult = await callHyperBackup(client, 'status', { task_id: '12' });
        const historyResult = await callHyperBackup(client, 'status', {
            task_id: '12',
            blOnline: 'false',
            additional: HYPER_BACKUP_STATUS_ADDITIONAL,
        });

        assert.equal(loginSession, 'Core');
        assert.equal(requestUrl, 'https://nas.local:5001/webapi/entry.cgi');
        assert.equal(requestOptions.method, 'POST');
        assert.deepEqual(requests, [
            {
                api: 'SYNO.Backup.Task', version: '1', method: 'status',
                task_id: '12', _sid: 'session-id',
            },
            {
                api: 'SYNO.Backup.Task', version: '1', method: 'status',
                task_id: '12', blOnline: 'false',
                additional: '["last_bkp_time","next_bkp_time","last_bkp_result","last_bkp_progress"]',
                _sid: 'session-id',
            },
        ]);
        assert.deepEqual(liveResult, { task_id: 12 });
        assert.deepEqual(historyResult, { task_id: 12 });
    });

    it('accepts object data for both list and status responses', async () => {
        for (const method of ['list', 'status']) {
            const data = { task_list: [], task_id: 12 };
            const client = {
                protocol: 'https',
                host: 'nas.local',
                port: 5001,
                auth: {
                    login: async () => ({ sid: 'session-id' }),
                    syno: {
                        request: async () => ({
                            ok: true,
                            json: async () => ({ success: true, data }),
                        }),
                    },
                },
            };

            assert.deepEqual(await callHyperBackup(client, method), data);
        }
    });

    it('rejects missing or non-object data for list and status responses', async () => {
        const malformedResponses = [
            { success: true },
            { success: true, data: null },
            { success: true, data: 'invalid' },
            { success: true, data: 42 },
            { success: true, data: false },
            { success: true, data: [] },
        ];

        for (const method of ['list', 'status']) {
            for (const payload of malformedResponses) {
                const client = {
                    protocol: 'https',
                    host: 'nas.local',
                    port: 5001,
                    auth: {
                        login: async () => ({ sid: 'session-id' }),
                        syno: {
                            request: async () => ({
                                ok: true,
                                json: async () => payload,
                            }),
                        },
                    },
                };

                await assert.rejects(
                    callHyperBackup(client, method),
                    /Hyper Backup returned invalid data/,
                );
            }
        }
    });

    it('accepts only status data containing a recognized mapped field', () => {
        for (const field of [
            'last_bkp_time',
            'next_bkp_time',
            'last_bkp_result',
            'last_bkp_error',
            'last_bkp_error_code',
            'last_bkp_progress',
            'status',
            'state',
            'progress',
        ]) {
            assert.equal(hasRecognizedHyperBackupStatus({ [field]: null }), true, field);
        }
        assert.equal(hasRecognizedHyperBackupStatus({}), false);
        assert.equal(hasRecognizedHyperBackupStatus({ unrelated: 'value' }), false);
    });

    it('fetches live and historical status separately and merges current fields first', async () => {
        const requests = [];
        const history = {
            status: 'finished', state: 'idle', progress: 0,
            last_bkp_result: 'success', last_bkp_time: '2025/01/15 02:00:00',
        };
        const live = { status: 'running', state: 'backup', progress: 37 };
        const result = await fetchHyperBackupTaskStatus('12', async (params) => {
            requests.push(params);
            return requests.length === 1 ? live : history;
        });

        assert.deepEqual(requests, [
            { task_id: '12' },
            {
                task_id: '12',
                blOnline: 'false',
                additional: HYPER_BACKUP_STATUS_ADDITIONAL,
            },
        ]);
        assert.deepEqual(result, {
            status: {
                status: 'running',
                state: 'backup',
                progress: 37,
                last_bkp_result: 'success',
                last_bkp_time: '2025/01/15 02:00:00',
            },
            errors: [],
        });
        assert.deepEqual(mapHyperBackupTasks([{
            task_id: 12,
            task_name: 'Nightly',
            status: 'none',
            state: 'idle',
            progress: 0,
        }], new Map([['12', result.status]])), [{
            id: '12',
            name: 'Nightly',
            status: 'running',
            state: 'backup',
            progress: 37,
            last_bkp_result: 'success',
            last_bkp_time: '2025/01/15 02:00:00',
        }]);
    });

    it('keeps partial status results and reports which status request failed', async () => {
        const result = await fetchHyperBackupTaskStatus('12', async (params) => {
            if (params.blOnline === 'false') {
                throw new Error('History API unavailable');
            }
            return { status: 'running', state: 'backup', progress: 37 };
        });

        assert.deepEqual(result.status, {
            status: 'running', state: 'backup', progress: 37,
        });
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].source, 'history');
        assert.match(result.errors[0].error.message, /History API unavailable/);
    });

    it('requests the exact DSM status fields as a JSON array', () => {
        assert.equal(
            HYPER_BACKUP_STATUS_ADDITIONAL,
            '["last_bkp_time","next_bkp_time","last_bkp_result","last_bkp_progress"]',
        );
    });

    it('accepts the DSM task list and maps status by task ID', () => {
        const status = {
            last_bkp_time: '2025/01/15 02:00:00',
            next_bkp_time: '2025/01/16 02:00',
            last_bkp_result: 'success',
            last_bkp_error: '',
            last_bkp_error_code: 0,
            last_bkp_progress: '[{"name":"backup","progress":42}]',
        };
        const tasks = getHyperBackupTaskList({ task_list: [
            {
                task_id: 12,
                task_name: 'Nightly',
                status: 'backup',
                state: 'backupable',
                progress: { progress: 42 },
            },
            { task_id: 'archive', task_name: 'Archive' },
        ] });

        assert.deepEqual(mapHyperBackupTasks(tasks, new Map([
            ['12', status],
        ])), [
            {
                id: '12',
                name: 'Nightly',
                status: 'backup',
                state: 'backupable',
                progress: { progress: 42 },
                last_bkp_time: '2025/01/15 02:00:00',
                next_bkp_time: '2025/01/16 02:00',
                last_bkp_result: 'success',
                last_bkp_error: '',
                last_bkp_error_code: 0,
                last_bkp_progress: [{ name: 'backup', progress: 42 }],
            },
            { id: 'archive', name: 'Archive' },
        ]);
    });

    it('keys channels by a safe stable task ID, not the task name', () => {
        const first = mapHyperBackupTasks([{ task_id: '3', task_name: 'Nightly' }], new Map())[0];
        const renamed = mapHyperBackupTasks([{ task_id: '3', task_name: 'Daily' }], new Map())[0];
        assert.equal(hyperBackupTaskChannelId(first.id), 'HyperBackup.tasks.3');
        assert.equal(hyperBackupTaskChannelId(renamed.id), 'HyperBackup.tasks.3');
        assert.notEqual(hyperBackupTaskChannelId('a.b'), 'HyperBackup.tasks.a.b');
        assert.notEqual(hyperBackupTaskChannelId('a.b'), hyperBackupTaskChannelId('a_2Eb'));
        assert.notEqual(hyperBackupTaskChannelId('a.b'), hyperBackupTaskChannelId('a_b'));
        assert.deepEqual(projectHyperBackupTaskStates(renamed), [
            { id: 'name', name: 'Task name', value: 'Daily', type: 'string', role: 'info.name' },
        ]);
    });

    it('normalizes fully qualified view rows to adapter-relative task IDs', () => {
        assert.equal(normalizeHyperBackupObjectId('synology.0.HyperBackup.tasks.3', 'synology.0'), 'HyperBackup.tasks.3');
        assert.equal(normalizeHyperBackupObjectId('synology.0.HyperBackup.tasks.3.progress', 'synology.0'), 'HyperBackup.tasks.3.progress');
        assert.equal(normalizeHyperBackupObjectId('synology.1.HyperBackup.tasks.3', 'synology.0'), undefined);
        assert.equal(normalizeHyperBackupObjectId('synology.0.DownloadStation.tasks.3', 'synology.0'), undefined);
    });

    it('plans cleanup only for stale task channels in the owned namespace', () => {
        assert.deepEqual(planStaleHyperBackupChannels([
            'HyperBackup.tasks.3', 'HyperBackup.tasks.4', 'HyperBackup.other.5',
        ], ['HyperBackup.tasks.3']), ['HyperBackup.tasks.4']);
        assert.deepEqual(planStaleHyperBackupChannels(
            ['HyperBackup.tasks.3'], [],
        ), ['HyperBackup.tasks.3']);
    });

    it('uses clear display labels while preserving task state IDs and values', () => {
        assert.deepEqual(HYPER_BACKUP_TASK_STATE_NAMES, {
            id: 'Task ID',
            name: 'Task name',
            status: 'Backup status',
            state: 'Task state',
            progress: 'Current backup progress',
            last_bkp_time: 'Last backup time',
            next_bkp_time: 'Next scheduled backup',
            last_bkp_result: 'Last backup result',
            last_bkp_error: 'Last backup error',
            last_bkp_error_code: 'Last backup error code',
            last_bkp_progress: 'Last backup progress details',
        });
        const task = {
            name: 'Nightly',
            status: 'running',
            state: 'backup',
            progress: 42,
            last_bkp_time: 1736906400000,
            next_bkp_time: '2025/01/16 02:00',
            last_bkp_result: 'success',
            last_bkp_error: 'none',
            last_bkp_error_code: 'E123',
            last_bkp_progress: { files: 3 },
        };
        const states = projectHyperBackupTaskStates(task);
        assert.deepEqual(states.map(({ id, name, value }) => ({ id, name, value })), [
            { id: 'name', name: 'Task name', value: 'Nightly' },
            { id: 'status', name: 'Backup status', value: 'running' },
            { id: 'state', name: 'Task state', value: 'backup' },
            { id: 'progress', name: 'Current backup progress', value: 42 },
            { id: 'last_bkp_time', name: 'Last backup time', value: 1736906400000 },
            { id: 'next_bkp_time', name: 'Next scheduled backup', value: '2025/01/16 02:00' },
            { id: 'last_bkp_result', name: 'Last backup result', value: 'success' },
            { id: 'last_bkp_error', name: 'Last backup error', value: 'none' },
            { id: 'last_bkp_error_code', name: 'Last backup error code', value: 'E123' },
            { id: 'last_bkp_progress', name: 'Last backup progress details', value: '{"files":3}' },
        ]);
    });

    it('projects structured values as JSON strings and preserves scalar values', () => {
        assert.deepEqual(projectHyperBackupTaskStates({
            id: '3', name: 'Nightly', progress: { progress: 42 }, last_bkp_error_code: 0,
        }), [
            { id: 'name', name: 'Task name', value: 'Nightly', type: 'string', role: 'info.name' },
            { id: 'progress', name: 'Current backup progress', value: '{"progress":42}', type: 'string', role: 'json' },
            { id: 'last_bkp_error_code', name: 'Last backup error code', value: 0, type: 'number', role: 'value' },
        ]);
    });

    it('projects timestamp and numeric metadata with type-appropriate roles and omits nulls', () => {
        assert.deepEqual(projectHyperBackupTaskStates({
            id: '4',
            name: 'Incremental',
            last_bkp_time: '2025/01/15 02:00:00',
            next_bkp_time: '2025/01/16 02:00',
            progress: '42%',
            last_bkp_error_code: 'E123',
            last_bkp_result: { success: true },
            last_bkp_error: null,
            last_bkp_progress: undefined,
        }), [
            { id: 'name', name: 'Task name', value: 'Incremental', type: 'string', role: 'info.name' },
            { id: 'progress', name: 'Current backup progress', value: '42%', type: 'string', role: 'text' },
            { id: 'last_bkp_time', name: 'Last backup time', value: '2025/01/15 02:00:00', type: 'string', role: 'date' },
            { id: 'next_bkp_time', name: 'Next scheduled backup', value: '2025/01/16 02:00', type: 'string', role: 'date' },
            { id: 'last_bkp_result', name: 'Last backup result', value: '{"success":true}', type: 'string', role: 'json' },
            { id: 'last_bkp_error_code', name: 'Last backup error code', value: 'E123', type: 'string', role: 'text' },
        ]);
    });

    it('distinguishes valid empty task lists from malformed or missing lists', () => {
        assert.equal(parseHyperBackupTaskList(undefined), undefined);
        assert.equal(parseHyperBackupTaskList({ task_list: 'invalid' }), undefined);
        assert.deepEqual(parseHyperBackupTaskList({ task_list: [] }), []);
        assert.deepEqual(parseHyperBackupTaskList({ task_list: [{ task_id: 3 }] }), [{ task_id: 3 }]);
        assert.deepEqual(parseHyperBackupTaskList({ task_list: [{ id: 'task-1' }] }), [{ id: 'task-1' }]);
        for (const task of [
            {},
            { task_id: '' },
            { task_id: '   ' },
            { task_id: null },
            { task_id: Number.NaN },
            { task_id: Number.POSITIVE_INFINITY },
        ]) {
            assert.equal(parseHyperBackupTaskList({ task_list: [task] }), undefined);
            assert.equal(parseHyperBackupTaskList({ task_list: [{ task_id: 3 }, task] }), undefined);
        }
        assert.deepEqual(getHyperBackupTaskList(undefined), []);
        assert.deepEqual(getHyperBackupTaskList({ task_list: 'invalid' }), []);
        assert.deepEqual(getHyperBackupTaskList({ task_list: [] }), []);
    });

    it('preserves optional status states when an active task status poll fails', () => {
        const channel = hyperBackupTaskChannelId('3');
        assert.deepEqual(planStaleHyperBackupStates([
            `${channel}.name`, `${channel}.last_bkp_result`, `${channel}.old_status`,
        ], [channel], new Set([`${channel}.name`]), new Set(['3'])), []);
        assert.deepEqual(planStaleHyperBackupChannels([
            channel, hyperBackupTaskChannelId('4'),
        ], [channel]), [hyperBackupTaskChannelId('4')]);
    });
});
