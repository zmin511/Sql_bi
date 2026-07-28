export function quoteIdentifier(value) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  if (!text.trim()) return null;
  return "[" + text.replace(/\]/g, "]]") + "]";
}

export function qualifiedColumn(alias, column) {
  const quoted = quoteIdentifier(column);
  if (!quoted) return null;
  return alias ? `${alias}.${quoted}` : quoted;
}

export function stableAliasHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function fitColumnAlias(baseName, suffix = "") {
  const maxIdentifierLength = 128;
  const base = String(baseName);
  const room = maxIdentifierLength - suffix.length;
  if (room <= 0) return null;
  if (base.length <= room) return base + suffix;
  const marker = `~${stableAliasHash(base)}`;
  return base.slice(0, Math.max(0, room - marker.length)) + marker + suffix;
}

export function makeUniqueColumnAlias(baseName, usedAliases) {
  if (baseName === undefined || baseName === null || !String(baseName).trim()) {
    return null;
  }

  const base = String(baseName);
  let number = 1;
  while (number < 100000) {
    const suffix = number === 1 ? "" : ` (${number})`;
    const candidate = fitColumnAlias(base, suffix);
    if (!candidate) return null;
    const key = candidate.toLocaleLowerCase("ru-RU");
    if (!usedAliases.has(key)) {
      usedAliases.add(key);
      return quoteIdentifier(candidate);
    }
    number += 1;
  }
  return null;
}

export function outputAliasBase(row, displayPath = "") {
  if (displayPath && String(displayPath).trim()) return String(displayPath);
  const candidates = [row && row.title, row && row.object, row && row.internal];
  const value = candidates.find(
    item => item !== undefined && item !== null && String(item).trim()
  );
  return value === undefined ? null : String(value);
}

export function qname(db, schema, table) {
  const tablePart = quoteIdentifier(table);
  if (!tablePart) return null;
  const parts = [];
  if (db !== undefined && db !== null && String(db).trim()) {
    parts.push(quoteIdentifier(db));
  }
  if (schema !== undefined && schema !== null && String(schema).trim()) {
    parts.push(quoteIdentifier(schema));
  }
  parts.push(tablePart);
  return parts.join(".");
}
