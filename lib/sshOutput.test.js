'use strict';

const { expect } = require('chai');
const { filterSshStderr } = require('./sshOutput');

describe('sshOutput', () => {
    it('filters sudo password prompts and missing home directory notices', () => {
        const output = [
            'Password:',
            '[sudo] password for admin:',
            'Could not chdir to home directory /var/services/homes/admin: No such file or directory',
            'shutdown: proceeding'
        ].join('\n');

        expect(filterSshStderr(output)).to.equal('shutdown: proceeding');
    });

    it('returns an empty string when stderr only contains harmless notices', () => {
        const output = 'Password:\nCould not chdir to home directory /home/admin: No such file or directory';

        expect(filterSshStderr(output)).to.equal('');
    });
});