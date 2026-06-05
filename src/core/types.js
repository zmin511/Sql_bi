export function isReferenceType(typeStr) {
  const type = String(typeStr || "").toLowerCase();
  return type.includes("справочник.") || type.includes("перечисление.");
}

export function isReferenceField(row) {
  const internal = String(row && row.internal || "");
  return isReferenceType(row && row.type) || /rref$/i.test(internal) || /_idrref$/i.test(internal);
}

export function isRootRefTable(row) {
  const internal = String(row && row.internal || "");
  return /^_reference/i.test(internal) || /^_enum/i.test(internal);
}

export function isBoolType(typeStr) {
  const type = String(typeStr || "").toLowerCase();
  return /bool|boolean|bit/.test(type) || type.includes("булев") || type.includes("логич");
}

export function isDateField(row) {
  const source = `${row && row.object || ""} ${row && row.title || ""} ${row && row.type || ""} ${row && row.internal || ""}`.toLowerCase();
  return source.includes("дата") || source.includes("date") || String(row && row.internal || "").toLowerCase() === "_date_time";
}
