export function isVTTableName(name) {
  return /^(_Document|_Reference|_Catalog|_InfoRg|_AccumRg)[0-9A-Za-z_]+_VT/i.test(String(name || ""));
}

export function getDocPrefix(tableName) {
  if (!tableName) return null;
  const source = String(tableName);
  const vtPos = source.toUpperCase().indexOf("_VT");
  let base = vtPos > 0 ? source.slice(0, vtPos) : source;
  base = base.replace(/X\d+$/i, "");
  const match = base.match(/^(_Document[0-9A-Za-z_]+|_Reference[0-9A-Za-z_]+|_Catalog[0-9A-Za-z_]+|_InfoRg[0-9A-Za-z_]+|_AccumRg[0-9A-Za-z_]+|_Enum[0-9A-Za-z_]+)/i);
  return match ? match[1] : null;
}

export function tableFor(row, byId) {
  let current = row;
  let tableNode = null;
  while (current) {
    const name = String(current.internal || current.object || "");
    if (/^_Document[0-9A-Za-z_]+_VT/i.test(name)) {
      tableNode = current;
    } else if (!tableNode && /^(_Document[0-9A-Za-z_]+|_Reference[0-9A-Za-z_]+|_Catalog[0-9A-Za-z_]+|_InfoRg[0-9A-Za-z_]+|_AccumRg[0-9A-Za-z_]+|_Enum[0-9A-Za-z_]+)/i.test(name)) {
      tableNode = current;
    }
    if (!current.parentId) break;
    current = byId[current.parentId];
  }
  return tableNode;
}
