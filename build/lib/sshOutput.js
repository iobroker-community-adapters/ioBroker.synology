"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterSshStderr = filterSshStderr;
/**
 * Filters harmless sudo prompts and missing-home notices from SSH stderr.
 *
 * @param output SSH stderr output.
 */
function filterSshStderr(output) {
    return String(output || "")
        .split(/\r?\n/)
        .filter((line) => {
        const trimmed = line.trim();
        return (trimmed &&
            !/^Password:\s*$/i.test(trimmed) &&
            !/^\[sudo\]\s+password for .+:\s*$/i.test(trimmed) &&
            !/^Could not chdir to home directory .+: No such file or directory$/i.test(trimmed));
    })
        .join("\n");
}
//# sourceMappingURL=sshOutput.js.map