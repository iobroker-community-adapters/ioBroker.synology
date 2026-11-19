'use strict';

const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const { COMMANDS, HELP } = require('../build/lib/help.js');

/** The commands of the message handler in src/main.ts */
function commandsOfMain() {
    const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
    const start = source.indexOf('message: (');
    const end = source.indexOf('function wake(', start);
    expect(start).to.be.greaterThan(0);
    expect(end).to.be.greaterThan(start);
    return [...source.slice(start, end).matchAll(/obj\.command === "([^"]+)"/g)].map((m) => m[1]);
}

describe('help', () => {
    it('lists exactly the commands the message handler answers, each once', () => {
        const names = COMMANDS.map((c) => c.command);
        expect(new Set(names).size).to.equal(names.length);
        expect([...names].sort()).to.deep.equal(commandsOfMain().sort());
    });

    it('marks every command as write true or false and names it in the text', () => {
        for (const { command, write } of COMMANDS) {
            expect(write, command).to.be.a('boolean');
            expect(HELP, command).to.include(command);
        }
        // the commands only return information; reboot, shutdown and sendMethod are states
        expect(COMMANDS.filter((c) => c.write)).to.deep.equal([]);
        expect(HELP).to.include('sendTo synology.0');
        expect(HELP).to.include('How to talk to the user:');
    });

    it('keeps the lines short', () => {
        for (const line of HELP.split('\n')) {
            expect(line.length, line).to.be.at.most(120);
        }
    });
});
