const assert = require('node:assert/strict');
const { needsFirstPollSessionDelay } = require('../build/lib/firstPollStartup.js');

describe('first poll two-factor session delay', () => {
    const active = () => true;

    it('waits before a station session first used by the next request', () => {
        assert.equal(
            needsFirstPollSessionDelay([{ api: 'dsm' }, { api: 'fs' }], 0, active),
            true,
        );
    });

    it('does not wait when the next station session was already visited', () => {
        const tasks = [{ api: 'dsm' }, { api: 'fs' }, { api: 'dsm' }];
        assert.equal(needsFirstPollSessionDelay(tasks, 0, active), true);
        assert.equal(needsFirstPollSessionDelay(tasks, 1, active), false);
    });

    it('skips function tasks without shifting active task indices', () => {
        const nonApiTask = () => undefined;
        const tasks = [{ api: 'dsm' }, nonApiTask, { api: 'fs' }];
        assert.equal(needsFirstPollSessionDelay(tasks, 0, active), true);
        assert.equal(needsFirstPollSessionDelay(tasks, 1, active), false);
        assert.equal(needsFirstPollSessionDelay(tasks, 2, active), false);
    });

    it('groups calls sharing one station session', () => {
        const tasks = [{ api: 'ss' }, { api: 'ss' }, { api: 'ss' }];
        assert.equal(needsFirstPollSessionDelay(tasks, 0, active), false);
        assert.equal(needsFirstPollSessionDelay(tasks, 1, active), false);
    });

    it('maps DTV to the VideoStation session', () => {
        assert.equal(
            needsFirstPollSessionDelay([{ api: 'dtv' }, { api: 'vs' }], 0, active),
            false,
        );
    });

    it('skips inactive tasks when finding sessions', () => {
        const tasks = [{ api: 'dsm' }, { api: 'ss' }, { api: 'fs' }];
        assert.equal(
            needsFirstPollSessionDelay(tasks, 0, (task) => task.api !== 'ss'),
            true,
        );
    });

    it('does not wait after the last active request', () => {
        const tasks = [{ api: 'dsm' }, { api: 'fs' }];
        assert.equal(
            needsFirstPollSessionDelay(tasks, 0, (task) => task.api === 'dsm'),
            false,
        );
        assert.equal(needsFirstPollSessionDelay(tasks, 1, active), false);
    });
});
