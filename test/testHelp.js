const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COMMANDS, HELP } = require('../build/lib/help.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8');

/** The commands the message handler answers: `obj.command === "..."` inside `message: (` */
function commandsOfMain() {
    const start = source.indexOf('message: (');
    const end = source.indexOf('function wake(', start);
    assert.ok(start > 0 && end > start, 'message handler found');
    const names = [...source.slice(start, end).matchAll(/obj\.command === "([^"]+)"/g)].map((m) => m[1]);
    return [...new Set(names)];
}

describe('help', () => {
    it('lists every command of the message handler once', () => {
        const listed = COMMANDS.map((c) => c.command);
        assert.equal(new Set(listed).size, listed.length);
        assert.deepEqual([...listed].sort(), commandsOfMain().sort());
    });

    it('marks every command as write true or false and names it in the text', () => {
        for (const { command, write } of COMMANDS) {
            assert.equal(typeof write, 'boolean', command);
            assert.ok(HELP.includes(command), command);
        }
        // none of the messages has an effect beyond writing a picture into the files of the adapter
        assert.deepEqual(
            COMMANDS.filter((c) => c.write).map((c) => c.command),
            [],
        );
    });

    it('marks the commands of the shared catalog with standard', () => {
        const marked = Object.fromEntries(COMMANDS.filter((c) => c.standard).map((c) => [c.command, c.standard]));
        assert.deepEqual(marked, { getCameras: 'camera.getCameras', snapshot: 'camera.snapshot' });
        assert.ok(HELP.includes('shared catalog'));
    });

    it('keeps the lines short', () => {
        for (const line of HELP.split(/\r?\n/)) {
            assert.ok(line.length <= 120, line);
        }
    });
});
