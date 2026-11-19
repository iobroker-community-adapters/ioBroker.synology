const assert = require('node:assert/strict');
const Module = require('node:module');

/** Starts build/main.js with a stub of adapter-core and returns the options it passed (the handlers) */
function startWithStub(fakeAdapter) {
    const corePath = require.resolve('@iobroker/adapter-core');
    const mainPath = require.resolve('../build/main.js');
    const saved = require.cache[corePath];
    const stub = new Module(corePath);
    stub.filename = corePath;
    stub.loaded = true;
    let options;
    stub.exports = {
        adapter: (o) => {
            options = o;
            return fakeAdapter;
        },
    };
    require.cache[corePath] = stub;
    try {
        delete require.cache[mainPath];
        require(mainPath)();
    } finally {
        if (saved) {
            require.cache[corePath] = saved;
        } else {
            delete require.cache[corePath];
        }
        delete require.cache[mainPath];
    }
    return options;
}

describe('message getSnapshot', () => {
    it('answers an error without a message or without camId instead of throwing', () => {
        const answers = [];
        const options = startWithStub({
            log: { debug() {}, info() {}, warn() {}, error() {} },
            sendTo: (_from, command, message) => answers.push({ command, message }),
        });
        const from = 'system.adapter.test.0';
        options.message({ command: 'getSnapshot', from, callback: { id: 1 } });
        options.message({ command: 'getSnapshot', message: {}, from, callback: { id: 2 } });
        assert.deepEqual(answers, [
            { command: 'getSnapshot', message: { error: 'camId is missing' } },
            { command: 'getSnapshot', message: { error: 'camId is missing' } },
        ]);
    });
});
