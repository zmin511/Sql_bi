export function normalizeHeader(header) {
  const h = String(header || "").trim().toLowerCase();
  const map = {
    "объекты": "object",
    "объект": "object",
    "object": "object",
    "name": "object",
    "название": "object",
    "заголовок": "title",
    "наименование": "title",
    "title": "title",
    "тип": "type",
    "type": "type",
    "внутреннее имя": "internal",
    "внутреннееимя": "internal",
    "internalname": "internal",
    "internal": "internal",
    "код": "internal",
    "code": "internal",
    "parent": "parentId",
    "родитель": "parentId",
    "parentid": "parentId",
    "уровень": "level",
    "level": "level",
    "id": "id"
  };
  return map[h] || h;
}

export function rowFromObject(row, idx = 0) {
  const norm = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    norm[normalizeHeader(key)] = value;
  });
  const id = String(norm.id || idx + 1);
  return {
    id,
    object: String(norm.object || norm.title || norm.internal || `Поле ${idx + 1}`),
    type: norm.type ? String(norm.type) : undefined,
    internal: norm.internal ? String(norm.internal) : undefined,
    title: norm.title ? String(norm.title) : undefined,
    parentId: norm.parentId ? String(norm.parentId) : null,
    level: norm.level !== undefined && norm.level !== "" ? Number(norm.level) : undefined
  };
}

export function rowsFromTableObjects(json) {
  return (json || []).map(rowFromObject);
}
