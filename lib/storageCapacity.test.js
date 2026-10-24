'use strict';

const { expect } = require('chai');
const { calculateFreeSize } = require('../build/lib/storageCapacity.js');

describe('storageCapacity', () => {
    it('calculates remaining volume capacity in GiB', () => {
        expect(calculateFreeSize(500 * 1024 ** 3, 125 * 1024 ** 3)).to.equal(375);
    });
});