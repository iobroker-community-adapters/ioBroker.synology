"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSmartAttributes = parseSmartAttributes;
/**
 * Parses SMART command output into attribute names and numeric or text values.
 *
 * @param output Raw SMART command output or a value to serialize and parse.
 */
function parseSmartAttributes(output) {
    const attributes = {};
    const text = typeof output === "string"
        ? output
        : output == null
            ? ""
            : JSON.stringify(output) || "";
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*\d+\s+([A-Za-z0-9_]+)\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+?)\s*$/);
        if (!match) {
            continue;
        }
        const rawValue = match[2];
        attributes[match[1]] = /^-?\d+$/.test(rawValue)
            ? Number(rawValue)
            : rawValue;
    }
    return attributes;
}
//# sourceMappingURL=smartAttributes.js.map