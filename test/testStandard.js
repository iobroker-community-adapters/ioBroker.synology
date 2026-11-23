const assert = require('node:assert/strict');
const Module = require('node:module');
const { checkFileName, findCamera, toStandardCameras } = require('../build/lib/standard.js');

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

// states.SurveillanceStation.cameras as parselistCameras fills it
const CAMERAS = {
    'Front door': { id: 1, status: 'Normal', model: 'DS-2CD' },
    Garden: { id: 2, status: 'Disconnected' },
    'Garden shed': { id: 12, status: 'Normal' },
    'Not listed yet': { status: 'Normal' },
};

describe('commands of the shared catalog', () => {
    it('getCameras lists the cameras of Surveillance Station', () => {
        assert.deepEqual(toStandardCameras(CAMERAS), [
            { id: '1', name: 'Front door', online: true },
            { id: '2', name: 'Garden', online: false },
            { id: '12', name: 'Garden shed', online: true },
        ]);
        assert.deepEqual(toStandardCameras({ Cam: { id: 3 } }), [{ id: '3', name: 'Cam' }]);
    });

    it('finds the camera by its number or name without case, exact before partial', () => {
        const cameras = toStandardCameras(CAMERAS);
        assert.equal(findCamera(cameras, '1').name, 'Front door');
        assert.equal(findCamera(cameras, 2).name, 'Garden');
        assert.equal(findCamera(cameras, 'garden').name, 'Garden');
        assert.equal(findCamera(cameras, 'FRONT').name, 'Front door');
        assert.equal(findCamera(cameras, ' shed ').name, 'Garden shed');
        assert.deepEqual(findCamera(cameras, 'den'), {
            error: '"den" fits several cameras',
            reason: 'AMBIGUOUS',
            candidates: ['Garden', 'Garden shed'],
        });
        assert.deepEqual(findCamera(cameras, 'kitchen'), {
            error: 'Camera "kitchen" not found',
            reason: 'NOT_FOUND',
            candidates: ['Front door', 'Garden', 'Garden shed'],
        });
        assert.equal(findCamera(cameras, '').reason, 'BAD_REQUEST');
        assert.equal(findCamera(cameras, undefined).reason, 'BAD_REQUEST');
    });

    it('checks fileName', () => {
        assert.equal(checkFileName('/snapshots/door.jpg'), 'snapshots/door.jpg');
        assert.equal(checkFileName('door.jpg'), 'door.jpg');
        assert.equal(checkFileName('../door.jpg').reason, 'BAD_REQUEST');
        assert.equal(checkFileName('a/./b.jpg').reason, 'BAD_REQUEST');
        assert.equal(checkFileName('').reason, 'BAD_REQUEST');
        assert.equal(checkFileName(5).reason, 'BAD_REQUEST');
    });

    it('answers getCameras and snapshot over the message handler', async () => {
        const answers = [];
        const options = startWithStub({
            namespace: 'synology.0',
            log: { debug() {}, info() {}, warn() {}, error() {} },
            sendTo: (_from, command, message) => answers.push({ command, message }),
            setTimeout,
            clearTimeout,
        });
        const from = 'system.adapter.assistant.0';
        const ask = async (command, message, callback = { id: 1 }) => {
            answers.length = 0;
            options.message({ command, message, from, callback });
            await new Promise((resolve) => setImmediate(resolve));
            return answers.map((a) => a.message);
        };
        // before the first poll there are no cameras
        assert.deepEqual(await ask('getCameras', {}), [{ cameras: [] }]);
        assert.deepEqual(await ask('getCameras'), [{ cameras: [] }]);
        assert.deepEqual(await ask('snapshot', { camera: 'door' }), [
            { error: 'Camera "door" not found', reason: 'NOT_FOUND', candidates: [] },
        ]);
        assert.deepEqual(await ask('snapshot', 'door'), [
            { error: 'Camera "door" not found', reason: 'NOT_FOUND', candidates: [] },
        ]);
        assert.equal((await ask('snapshot', {}))[0].reason, 'BAD_REQUEST');
        assert.equal((await ask('snapshot', { camera: 'door', fileName: '../x.jpg' }))[0].reason, 'BAD_REQUEST');
        // a snapshot without a callback and without fileName does nothing
        assert.deepEqual(await ask('snapshot', { camera: 'door' }, null), []);
    });
});
