'use strict';

const { expect } = require('chai');
const { parseSmartAttributes } = require('../build/lib/smartAttributes.js');

describe('smartAttributes', () => {
    it('parses SMART raw values and keeps non-numeric annotations', () => {
        const output = [
            'SMART Attributes Data Structure revision number: 16',
            'ID# ATTRIBUTE_NAME FLAG VALUE WORST THRESH TYPE UPDATED WHEN_FAILED RAW_VALUE',
            '  5 Reallocated_Sector_Ct 0x0033 100 100 005 Pre-fail Always - 0',
            '  9 Power_On_Hours 0x0012 095 095 000 Old_age Always - 39191',
            '194 Temperature_Celsius 0x0002 144 144 000 Old_age Always - 45 (Min/Max 21/52)'
        ].join('\n');

        expect(parseSmartAttributes(output)).to.deep.equal({
            Reallocated_Sector_Ct: 0,
            Power_On_Hours: 39191,
            Temperature_Celsius: '45 (Min/Max 21/52)'
        });
    });

    it('returns an empty object when SMART data is unavailable', () => {
        expect(parseSmartAttributes('SMART support is unavailable')).to.deep.equal({});
    });
});