// A presentation-only projection of the authoritative query plan.  This must
// never discover or validate relationships: queryPlan.js already owns that.
const aliasOrder = alias => {
  if (alias === "H") return 0;
  if (alias === "T") return 1;
  const ref = /^R(\d+)$/.exec(alias || "");
  return ref ? 100 + Number(ref[1]) : 1000;
};
const roleForAlias = alias => alias === "H" ? "header" : alias === "T" ? "detail" : /^R\d+$/.test(alias || "") ? "reference" : "base";
const nodeId = alias => `alias:${alias}`;

export function buildQueryPlanView(plan) {
  if (!plan) return { status: "empty", reason: "no_plan", nodes: [], edges: [], diagnostics: [] };
  if (plan.status !== "ready") return { status: "blocked", reason: plan.reason || "blocked", nodes: [], edges: [], diagnostics: [...(plan.diagnostics || [])] };
  if (!plan.sqlParts || plan.sqlParts.empty) return { status: "empty", reason: "empty_selection", nodes: [], edges: [], diagnostics: [...(plan.diagnostics || [])] };
  const nodes = new Map();
  const ensure = (alias, table) => {
    if (!alias) return null;
    if (!nodes.has(alias)) nodes.set(alias, { id: nodeId(alias), alias, table: table || "", role: roleForAlias(alias), fields: [], filters: [] });
    const node = nodes.get(alias); if (!node.table && table) node.table = table;
    return node;
  };
  for (const selection of plan.selections || []) {
    const node = ensure(selection.sourceAlias, selection.sourceTable);
    if (node) node.fields.push({ id: selection.id, field: selection.sourceField, label: selection.outputAlias || selection.sourceField, expression: selection.expression });
  }
  const edges = [];
  for (const join of plan.joins || []) {
    if (join.status !== "sql") continue;
    ensure(join.sourceAlias, join.sourceTable); ensure(join.targetAlias, join.targetTable);
    edges.push({ id: `join:${join.id}`, joinId: join.id, kind: join.kind, sourceId: nodeId(join.sourceAlias), targetId: nodeId(join.targetAlias), sourceAlias: join.sourceAlias, targetAlias: join.targetAlias, sourceColumn: join.sourceColumn, targetColumn: join.targetColumn, confirmation: join.confirmation || null, sql: join.sql || "", status: "sql" });
  }
  for (const filter of plan.filters || []) {
    const selection = (plan.selections || []).find(item => item.id === filter.fieldId || item.selectionId === filter.fieldId);
    const node = selection && ensure(selection.sourceAlias, selection.sourceTable);
    if (node) node.filters.push({ id: filter.id, field: selection.sourceField, operator: filter.operator, expression: filter.expression || "" });
  }
  const ordered = [...nodes.values()].sort((a, b) => aliasOrder(a.alias) - aliasOrder(b.alias) || a.alias.localeCompare(b.alias));
  for (const node of ordered) { node.fields.sort((a, b) => a.label.localeCompare(b.label)); node.filters.sort((a, b) => a.id.localeCompare(b.id)); }
  edges.sort((a, b) => a.id.localeCompare(b.id));
  return { status: "ready", reason: null, nodes: ordered, edges, diagnostics: [...(plan.diagnostics || [])] };
}
