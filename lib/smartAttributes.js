"use strict";

function parseSmartAttributes(output) {
  const attributes = {};
  const lines = String(output || "").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /^\s*\d+\s+([A-Za-z0-9_]+)\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+?)\s*$/,
    );
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

module.exports = { parseSmartAttributes };
