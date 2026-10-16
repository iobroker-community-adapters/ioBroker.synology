'use strict';

const { expect } = require('chai');
const { createSnapshotLink } = require('./snapshotLink.js');

describe('snapshotLink', () => {
    it('uses the current camera id without whitespace', () => {
        const link = createSnapshotLink({ protocol: 'https', host: 'nas', port: 5001, sessions: { SurveillanceStation: { _sid: 'sid' } } }, 42);
        expect(link).to.equal('https://nas:5001/webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=7&cameraId=42&_sid=sid');
    });
});
