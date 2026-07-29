import { buildQueryPlan } from "./queryPlan.js";
import { qname, qualifiedColumn } from "./sqlIdentifiers.js";

export { qname };
export function boolFilterValueForId(id, boolFilters = {}) { const item = boolFilters[id]; return item && item.yes && !item.no ? 1 : item && item.no && !item.yes ? 0 : null; }
export function chainText(chain) { return (chain || []).map(step => `${step.refInternal} -> ${step.targetTable}`).join(" / "); }

export function generateSql(input = {}) {
  const plan = buildQueryPlan(input);
  if (plan.status === "blocked") {
    const hint = plan.reason === "missing_metadata" ? "SQL not generated: selected synthetic metadata is missing."
      : plan.reason === "malformed_metadata" ? "SQL not generated: selected synthetic metadata is malformed."
      : String(plan.reason || "").includes("chain") || ["empty_chain", "missing_target_kind", "invalid_target_table", "target_root_changed", "repeated_target"].includes(plan.reason) ? "SQL not generated: selected reference chain is not valid."
      : plan.reason === "no_selected_columns" || plan.reason === "invalid_from_table" ? "SQL не сформирован."
      : "SQL не сформирован: выбор полей не подтверждён.";
    return { sql: "", diagnostics: plan.diagnostics, hint, plan };
  }
  if (plan.sqlParts.empty) return { sql: "-- Select at least one field", diagnostics: [], hint: "", plan };
  const parts = plan.sqlParts;
  const lines = ["SELECT", `  ${plan.selections.map(item => `${item.expression} AS ${item.outputAlias}`).join(",\n  ")}`, `FROM  ${parts.from} AS ${parts.baseAlias}`];
  for (const join of plan.joins) {
    if (join.status !== "sql") continue;
    if (join.kind === "header_detail") lines.push(`LEFT JOIN ${qname(String(input.dbName || "").trim(), String(input.schema || "").trim(), join.targetTable)} AS ${join.targetAlias} ON ${qualifiedColumn(join.sourceAlias, join.sourceColumn)} = ${qualifiedColumn(join.targetAlias, join.targetColumn)}`);
    else lines.push(`LEFT JOIN ${qname(String(input.dbName || "").trim(), String(input.schema || "").trim(), join.targetTable)} AS ${join.targetAlias} ON ${qualifiedColumn(join.targetAlias, join.targetColumn)} = ${qualifiedColumn(join.sourceAlias, join.sourceColumn)}`);
  }
  if (parts.wheres.length) lines.push(`WHERE ${parts.wheres.join(" AND ")}`);
  if (parts.orderBy) lines.push(`ORDER BY ${parts.orderBy}`);
  return { sql: lines.join("\n"), diagnostics: plan.diagnostics, hint: "", plan };
}
