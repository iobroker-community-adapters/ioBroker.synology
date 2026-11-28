const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ioPackage = require('../io-package.json');

describe('object state definitions', () => {
    it('omits defaults for affected object states', () => {
        const expectedIds = [
            'DiskStationManager.sendMethod',
            'FileStation.sendMethod',
            'DownloadStation.sendMethod',
            'AudioStation.sendMethod',
            'VideoStation.sendMethod',
            'VideoStation_DTV.sendMethod',
            'SurveillanceStation.sendMethod',
            'FileStation.sharing.create',
            'FileStation.sharing.delete',
        ];
        const definitions = new Map(ioPackage.instanceObjects.map(({ _id, common }) => [_id, common]));

        for (const id of expectedIds) {
            assert.ok(definitions.has(id), `${id} must be defined`);
            assert.equal(definitions.get(id).type, 'object', `${id} must retain its object type`);
            assert.equal(definitions.get(id).def, undefined, `${id} must not define an object default`);
        }
    });

    it('finds the station of every sendMethod state by the name of its channel', () => {
        // sendMethod looks the station up by name in states.api (isInstalled)
        const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
        const start = source.indexOf('api: {', source.indexOf('Object.assign(states, {'));
        const end = source.indexOf('type StateValueType', start);
        assert.ok(start > 0 && end > start, 'states.api found');
        const names = [...source.slice(start, end).matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
        const channels = ioPackage.instanceObjects
            .map(({ _id }) => _id)
            .filter((id) => id.endsWith('.sendMethod'))
            .map((id) => id.slice(0, -'.sendMethod'.length));
        assert.ok(channels.includes('VideoStation_DTV'));
        for (const channel of channels) {
            assert.ok(names.includes(channel), `${channel}.sendMethod has no station in states.api`);
        }
    });
});
