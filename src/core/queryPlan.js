import { castExpr } from "./casts.js";
import { buildManualDateRange, buildRelativeDateRange, sqlDateExpr } from "./dates.js";
import { validateRelationshipForSql } from "./relationships.js";
import { validateJoinChain, chainText } from "./references.js";
import { resolveSelectionContext } from "./selectionContext.js";
import { tableFor } from "./tableDetect.js";
import { isBoolType, isDateField } from "./types.js";
import { qname, qualifiedColumn, outputAliasBase, makeUniqueColumnAlias } from "./sqlIdentifiers.js";

function tableName(row) { return String((row && (row.internal || row.object)) || ""); }
function childrenFor(rows, inputChildren) {
  if (inputChildren) return inputChildren;
  return rows.reduce((result, row) => {
    if (row && row.parentId != null) (result[row.parentId] ||= []).push(row);
    return result;
  }, {});
}
function boolValue(id, filters = {}) {
  const value = filters[id];
  return value && value.yes && !value.no ? 1 : value && value.no && !value.yes ? 0 : null;
}
function periodRange(input, expression) {
  return input.periodMode === "manual"
    ? buildManualDateRange(expression, input.dateFrom, input.dateTo)
    : buildRelativeDateRange({ pastMonths: input.periodMonths, pastDays: input.periodDays, futureMonths: input.periodMonthsFuture, futureDays: input.periodDaysFuture }, expression);
}
function blocked(reason, diagnostics, selectionContext = null, joins = [], selections = []) {
  return { status: "blocked", reason, selectionContext, selections, joins, diagnostics, sqlParts: null };
}
function blockedSyntheticSelection(selectionId, reason, meta = null) {
  const field = meta && meta.field && typeof meta.field === "object" ? meta.field : null;
  const chain = meta && Array.isArray(meta.chain) ? meta.chain.map(step => ({ ...step })) : [];
  return {
    id: selectionId,
    selectionId,
    kind: "synth",
    sourceRowId: meta && meta.baseTopId || null,
    sourceTable: chain.length ? chain.at(-1).targetTable || null : null,
    sourceField: field ? String(field.internal || field.object || "") || null : null,
    sourceAlias: null,
    field: field ? { ...field } : null,
    outputAlias: null,
    expression: null,
    status: "blocked",
    reason,
    chain
  };
}

export function buildQueryPlan(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const byId = input.byId || {};
  const selected = input.selected || {};
  const metaById = input.metaById || {};
  const selectedIds = Object.keys(selected).filter(id => selected[id]);
  if (!selectedIds.length) return { status: "ready", reason: null, selectionContext: null, selections: [], joins: [], diagnostics: [], sqlParts: { empty: true } };
  const diagnostics = [];
  const original = selectedIds.filter(id => byId[id]).map(id => byId[id]);
  const synthetic = [];
  for (const id of selectedIds.filter(id => !byId[id])) {
    const meta = metaById[id];
    if (!meta || typeof meta !== "object") {
      diagnostics.push(`Synthetic selection blocked for ${id}: missing_metadata / selected_meta_not_found.`);
      return blocked("missing_metadata", diagnostics, null, [], [blockedSyntheticSelection(id, "missing_metadata")]);
    }
    if (!meta.field || typeof meta.field !== "object") {
      diagnostics.push(`Synthetic selection blocked for ${id}: malformed_metadata / missing_field.`);
      return blocked("malformed_metadata", diagnostics, null, [], [blockedSyntheticSelection(id, "malformed_metadata", meta)]);
    }
    const normalized = { ...meta, id };
    const validation = validateJoinChain(normalized.chain, { rows, maxDepth: input.refDepth });
    if (!validation.ok) {
      diagnostics.push(`Reference chain blocked for ${id}: ${validation.status || "unknown"} / ${validation.reason || "invalid_chain"}.`);
      return blocked(validation.reason || "invalid_chain", diagnostics);
    }
    synthetic.push(normalized);
  }
  const db = String(input.dbName || "").trim();
  const schema = String(input.schema || "").trim();
  const selectionContext = resolveSelectionContext([
    ...original.map(row => ({ kind: "orig", id: row.id, row })),
    ...synthetic.map(meta => ({ kind: "synth", id: meta.id, row: meta.field, meta }))
  ], { database: db, schema, manualFrom: input.fromTable, byId, rows, children: childrenFor(rows, input.children), tableFor: row => tableFor(row, byId), resolveTablePartHeaderJoin: input.resolveTablePartHeaderJoin });
  if (!selectionContext.valid) {
    diagnostics.push(...(selectionContext.diagnostics || []));
    if (!diagnostics.length) diagnostics.push(`Выбор полей заблокирован: ${selectionContext.reason || "unknown_selection_context"}.`);
    return blocked(selectionContext.reason || "invalid_selection_context", diagnostics, selectionContext);
  }
  original.sort((a, b) => `${tableName(tableFor(a, byId))}|${a.id}`.localeCompare(`${tableName(tableFor(b, byId))}|${b.id}`));
  synthetic.sort((a, b) => `${a.baseTopId || ""}|${chainText(a.chain)}|${a.id}`.localeCompare(`${b.baseTopId || ""}|${chainText(b.chain)}|${b.id}`));
  let relationship = null;
  const joins = [];
  if (selectionContext.mode === "header_detail") {
    const raw = selectionContext.relationships[0];
    const policy = validateRelationshipForSql(raw);
    const candidate = raw && raw.candidates && raw.candidates[0];
    if (!policy.valid) {
      if (candidate) joins.push({ id: `header_detail:${candidate.detailTable}:${candidate.detailForeignKeyColumn}:${candidate.headerTable}:${candidate.headerKeyColumn}`, kind: "header_detail", sourceRowId: null, sourceTable: candidate.detailTable, sourceAlias: "T", sourceColumn: candidate.detailForeignKeyColumn, targetRootId: null, targetTable: candidate.headerTable, targetAlias: "H", targetColumn: candidate.headerKeyColumn, status: candidate.confirmation === "mxl_structural_owner" ? "structural" : "blocked", reason: policy.reason, confirmation: candidate.confirmation || null, syntheticIds: [], depth: 0 });
      diagnostics.push(...policy.diagnostics);
      return blocked(policy.reason, diagnostics, selectionContext, joins);
    }
    relationship = policy.candidate;
    joins.push({ id: `header_detail:${relationship.detailTable}:${relationship.detailForeignKeyColumn}:${relationship.headerTable}:${relationship.headerKeyColumn}`, kind: "header_detail", sourceRowId: null, sourceTable: relationship.detailTable, sourceAlias: "T", sourceColumn: relationship.detailForeignKeyColumn, targetRootId: null, targetTable: relationship.headerTable, targetAlias: "H", targetColumn: relationship.headerKeyColumn, status: "sql", reason: null, confirmation: relationship.confirmation, syntheticIds: [], depth: 0, sql: `LEFT JOIN ${qname(db, schema, relationship.headerTable)} AS H ON ${qualifiedColumn("T", relationship.detailForeignKeyColumn)} = ${qualifiedColumn("H", relationship.headerKeyColumn)}` });
    if (!qname(db, schema, relationship.headerTable) || !qualifiedColumn("T", relationship.detailForeignKeyColumn) || !qualifiedColumn("H", relationship.headerKeyColumn)) {
      diagnostics.push("JOIN шапки не сформирован: отсутствует безопасный SQL-идентификатор.");
      joins[joins.length - 1].status = "blocked";
      joins[joins.length - 1].reason = "invalid_relationship_identifier";
      return blocked("invalid_relationship_identifier", diagnostics, selectionContext, joins);
    }
    diagnostics.push(`JOIN header: ${relationship.detailTable}.${relationship.detailForeignKeyColumn} -> ${relationship.headerTable}.${relationship.headerKeyColumn}`);
  }
  const baseTable = selectionContext.mode === "manual" ? selectionContext.basePhysicalTable : relationship ? relationship.detailTable : selectionContext.basePhysicalTable;
  const aliases = { base: selectionContext.mode === "manual" ? "F" : "T", header: selectionContext.mode === "manual" ? "F" : "H" };
  const usedAliases = new Set(); const selections = []; const wheres = []; const referenceByPath = new Map(); let nextReferenceAlias = 1;
  const ensureReference = (parentAlias, step, synthId, depth, sourceRowId, sourceTable) => {
    const key = `${parentAlias}.${step.refInternal}->${step.targetTable}`;
    const existing = referenceByPath.get(key);
    if (existing) { if (!existing.syntheticIds.includes(synthId)) existing.syntheticIds.push(synthId); return existing; }
    const targetAlias = `R${nextReferenceAlias++}`;
    const sourceColumn = String(step.refInternal || ""); const targetColumn = "_IDRRef";
    if (!qname(db, schema, step.targetTable) || !qualifiedColumn(parentAlias, sourceColumn)) {
      diagnostics.push(`JOIN reference blocked: invalid SQL identifier for ${step.targetTable || "<empty>"}.`);
      return null;
    }
    const targetRoot = rows.filter(row => String(row.internal || "").toLowerCase() === String(step.targetTable || "").toLowerCase())[0] || null;
    const edge = { id: `reference:${parentAlias}:${sourceColumn}:${step.targetTable}:${targetColumn}:${depth}`, kind: "reference", sourceRowId, sourceTable, sourceAlias: parentAlias, sourceColumn, targetRootId: targetRoot && targetRoot.id || null, targetTable: step.targetTable, targetAlias, targetColumn, status: "sql", reason: null, confirmation: null, syntheticIds: [synthId], depth, sql: `LEFT JOIN ${qname(db, schema, step.targetTable)} AS ${targetAlias} ON ${qualifiedColumn(targetAlias, targetColumn)} = ${qualifiedColumn(parentAlias, sourceColumn)}` };
    referenceByPath.set(key, edge); joins.push(edge); return edge;
  };
  const addSelection = (id, kind, row, meta, sourceRow) => {
    const sourceTable = tableName(tableFor(sourceRow || row, byId));
    if (selectionContext.mode !== "manual" && sourceTable !== baseTable && sourceTable !== (relationship && relationship.headerTable)) return;
    let sourceAlias = relationship && sourceTable === relationship.headerTable ? aliases.header : aliases.base;
    let joinSourceRowId = sourceRow && sourceRow.id || null;
    let joinSourceTable = sourceTable;
    for (let index = 0; meta && index < meta.chain.length; index += 1) {
      const edge = ensureReference(sourceAlias, meta.chain[index], id, index + 1, joinSourceRowId, joinSourceTable); if (!edge) return; sourceAlias = edge.targetAlias; joinSourceRowId = null; joinSourceTable = edge.targetTable;
    }
    const field = meta ? meta.field : row;
    const expression = castExpr(sourceAlias, field.internal || field.object, field.type, diagnostics, field.title || field.object || field.internal);
    if (!expression) { diagnostics.push("Поле пропущено: отсутствует безопасное SQL-имя колонки."); return; }
    const outputAlias = makeUniqueColumnAlias(outputAliasBase(field, meta ? meta.displayPath : ""), usedAliases);
    if (!outputAlias) { diagnostics.push("Поле пропущено: невозможно сформировать выходной alias."); return; }
    const projectionSourceTable = meta && meta.chain.length ? meta.chain.at(-1).targetTable : sourceTable;
    selections.push({ id, selectionId: id, kind, sourceRowId: sourceRow ? sourceRow.id : row.id, sourceTable: projectionSourceTable, sourceField: String(field.internal || field.object || ""), sourceAlias, field: { ...field }, outputAlias, expression, status: "active", reason: null, chain: meta ? meta.chain.map(step => ({ ...step })) : [] });
    const bool = boolValue(id, input.boolFilters || {}); if (bool !== null && isBoolType(field.type)) wheres.push(`${expression} = ${bool}`);
  };
  original.forEach(row => addSelection(row.id, "orig", row, null, row));
  synthetic.forEach(meta => { const source = byId[meta.baseTopId]; if (source) addSelection(meta.id, "synth", null, meta, source); });
  if (!selections.length) return blocked("no_selected_columns", [...diagnostics, "SELECT не сформирован: нет выбранных колонок."], selectionContext, joins);
  const preview = periodRange(input, "__DATE__"); diagnostics.push(...(preview.diagnostics || [])); if (preview.description) diagnostics.push(preview.description);
  const periodField = input.periodFieldId ? byId[input.periodFieldId] || null : null;
  const periodAvailable = !!periodField && original.some(row => row.id === periodField.id) && isDateField(periodField);
  if ((preview.active || preview.requested) && !periodAvailable) diagnostics.push(!periodField ? "Период не применён: поле периода не выбрано." : "Период не применён: поле периода нельзя безопасно использовать в текущем контексте.");
  let orderBy = "";
  if (periodAvailable && preview.active) {
    const periodTable = tableName(tableFor(periodField, byId));
    if (selectionContext.mode === "manual" || periodTable === baseTable || periodTable === (relationship && relationship.headerTable)) {
      const alias = relationship && periodTable === relationship.headerTable ? aliases.header : aliases.base;
      const expression = sqlDateExpr(alias, periodField.internal || periodField.object, periodField.type);
      if (expression) { wheres.push(...periodRange(input, expression).conditions); orderBy = `${expression} DESC`; }
      else diagnostics.push("Период не применён: отсутствует безопасное SQL-имя поля даты.");
    } else diagnostics.push(`Период не применён: поле даты принадлежит ${periodTable || "другой таблице"}.`);
  }
  const from = qname(db, schema, baseTable);
  if (!from) return blocked("invalid_from_table", [...diagnostics, "FROM не сформирован: отсутствует безопасное имя таблицы."], selectionContext, joins);
  return { status: "ready", reason: null, selectionContext, selections, joins, diagnostics, sqlParts: { from, baseAlias: aliases.base, headerJoin: relationship ? joins[0] : null, wheres, orderBy } };
}
