const assert = require('node:assert/strict');
const ioPackage = require('../io-package.json');

describe('object state definitions', () => {
    it('uses object types and stringified JSON defaults for all affected states', () => {
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
            assert.equal(definitions.get(id).def, '{}', `${id} must use a stringified JSON default`);
        }
    });
});
