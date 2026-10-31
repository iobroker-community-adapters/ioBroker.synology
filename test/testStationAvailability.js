const assert = require('node:assert/strict');
const { isUnavailableStationProbeError } = require('../build/lib/stationAvailability.js');

describe('station API availability detection', () => {
    it('identifies a missing VideoStation API from its info probe', () => {
        assert.equal(isUnavailableStationProbeError('vs', 'getInfo', 102), true);
    });

    it('identifies a missing VideoStation DTV API from its tuner probe', () => {
        assert.equal(isUnavailableStationProbeError('dtv', 'GetInfoTuner', 102), true);
    });

    it('does not disable DSM or unrelated station methods', () => {
        assert.equal(isUnavailableStationProbeError('dsm', 'getInfo', 102), false);
        assert.equal(isUnavailableStationProbeError('vs', 'listVideos', 102), false);
        assert.equal(isUnavailableStationProbeError('vs', 'getInfo', 103), false);
    });
});
