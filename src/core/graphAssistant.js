import { resolveReferenceTarget } from "./references.js";

function fieldLabel(field) {
  return String(field.title || field.object || field.internal || "Field");
}

// Presentation-only candidates for the graph.  This deliberately reuses the
// reference resolver and returns no candidate until that resolver confirms one
// physical target.
export function getAvailableRelatedFields({ rows = [], selectedIds = [], maxDepth = 5 } = {}) {
  const selected = new Set(selectedIds);
  const result = [];

  for (const source of rows) {
    if (!selected.has(source.id)) continue;
    const resolution = resolveReferenceTarget(source, { rows, chain: [], maxDepth });
    if (resolution.status !== "resolved" || !resolution.target) continue;

    const target = resolution.target;
    const targetTable = String(target.internal || target.object || "");
    if (!targetTable) continue;
    const fields = [
      { object: "Наименование", title: "Наименование", internal: "_Description", type: "Строка" },
      { object: "Код", title: "Код", internal: "_Code", type: "Строка" },
      ...rows.filter(row => row.parentId === target.id).map(row => ({
        object: String(row.object || row.title || row.internal || "Поле"),
        title: String(row.title || row.object || row.internal || "Поле"),
        internal: String(row.internal || row.object || ""),
        type: String(row.type || "")
      }))
    ];
    const seen = new Set();
    const uniqueFields = fields.filter(field => {
      const key = String(field.internal || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(field => ({ ...field, label: fieldLabel(field) }));

    result.push({
      id: `reference:${source.id}:${targetTable}`,
      sourceRowId: source.id,
      sourceField: String(source.internal || source.object || ""),
      sourceLabel: fieldLabel(source),
      targetRootId: target.id,
      targetTable,
      targetLabel: fieldLabel(target),
      kind: resolution.kind,
      fields: uniqueFields
    });
  }

  return result;
}
