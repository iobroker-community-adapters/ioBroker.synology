'use strict';

const { expect } = require('chai');
const { createKeyedQueue, createRtspUrl, getCameraCodec, isH265 } = require('../build/lib/rtspSnapshot.js');

describe('rtspSnapshot', () => {
    it('reads the codec reported by Surveillance Station', () => {
        expect(getCameraCodec({videoType: 'H.265'}, {})).to.equal('H.265');
        expect(getCameraCodec({detailInfo: {camVideoType: 'HEVC'}}, {})).to.equal('HEVC');
        expect(getCameraCodec({videoCodec: 6}, {6: 'H265'})).to.equal('H265');
    });

    it('only identifies H.265 and HEVC codecs', () => {
        expect(isH265('H.265')).to.equal(true);
        expect(isH265('H265')).to.equal(true);
        expect(isH265('HEVC')).to.equal(true);
        expect(isH265('H.264')).to.equal(false);
    });

    it('uses the streaming credentials from Synology\'s RTSP path', () => {
        const camera = {
            id: 16,
            linkRtspOverHttpPath: 'rtsp://nas/webman/rtsp.cgi?Sms=16.unicast&DsId=0&StmKey=stream-key',
            linkRtspPath: 'rtsp://syno:stream-key@nas:554/Sms=16.unicast'
        };
        expect(createRtspUrl(camera, 'nas'))
            .to.equal('rtsp://syno:stream-key@nas:554/Sms=16.unicast');
    });

    it('fails clearly when no RTSP stream path is available', () => {
        expect(() => createRtspUrl({id: 16}, 'nas'))
            .to.throw('RTSP-over-HTTP path is not available yet');
    });

    it('requires streaming credentials in the RTSP path', () => {
        const camera = {
            id: 16,
            linkRtspOverHttpPath: 'rtsp://nas/path?StmKey=stream-key',
            linkRtspPath: 'rtsp://nas:554/Sms=16.unicast'
        };
        expect(() => createRtspUrl(camera, 'nas'))
            .to.throw('Synology did not provide RTSP streaming credentials');
    });

    it('serializes queued tasks per camera while allowing different cameras independently', async () => {
        const enqueue = createKeyedQueue();
        const events = [];
        let releaseFirst;
        const first = enqueue(16, () => new Promise(resolve => {
            events.push('first-start');
            releaseFirst = () => {
                events.push('first-end');
                resolve();
            };
        }));
        const second = enqueue(16, async () => events.push('second'));
        const otherCamera = enqueue(17, async () => events.push('other-camera'));

        await otherCamera;
        expect(events).to.deep.equal(['first-start', 'other-camera']);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).to.deep.equal(['first-start', 'other-camera', 'first-end', 'second']);
    });
});
