import { castExpr } from "./casts.js";
import { buildManualDateRange, buildRelativeDateRange, sqlDateExpr } from "./dates.js";
import { validateRelationshipForSql } from "./relationships.js";
import { resolveSelectionContext } from "./selectionContext.js";
import { tableFor } from "./tableDetect.js";
import { isBoolType, isDateField } from "./types.js";

export function qname(db, schema, table) {
  const dbPart = db ? `[${db}].` : "";
  const schemaPart = schema ? `[${schema}].` : "";
  return `${dbPart}${schemaPart}[${table}]`;
}

export function boolFilterValueForId(id, boolFilters = {}) {
  const item = boolFilters[id];
  if (!item) return null;
  if (!!item.yes && !item.no) return 1;
  if (!!item.no && !item.yes) return 0;
  return null;
}

export function chainText(chain) {
  return (chain || []).map(step => `${step.refInternal} -> ${step.targetTable}`).join(" / ");
}

function asTableName(row) {
  return String((row && (row.internal || row.object)) || "");
}

function buildSelectedPeriodRange(input, expression) {
  return input.periodMode === "manual"
    ? buildManualDateRange(expression, input.dateFrom, input.dateTo)
    : buildRelativeDateRange({
      pastMonths: input.periodMonths,
      pastDays: input.periodDays,
      futureMonths: input.periodMonthsFuture,
      futureDays: input.periodDaysFuture
    }, expression);
}

function buildPeriodContext(input, selectedOrig, periodField, diagnostics) {
  const preview = buildSelectedPeriodRange(input, "__DATE__");
  const fieldAvailable = !!periodField &&
    selectedOrig.some(row => row.id === periodField.id) &&
    isDateField(periodField);
  diagnostics.push(...(preview.diagnostics || []));
  if (preview.description) diagnostics.push(preview.description);
  if ((preview.active || preview.requested) && !fieldAvailable) {
    diagnostics.push(!periodField
      ? "Период не применён: поле периода не выбрано."
      : "Период не применён: поле периода нельзя безопасно использовать в текущем контексте.");
  }
  return { input, preview, fieldAvailable };
}

function addPeriodWhere(wheres, alias, row, period) {
  if (!row || !period.fieldAvailable || !period.preview.active) return "";
  const expression = sqlDateExpr(alias, row.internal || row.object, row.type);
  wheres.push(...buildSelectedPeriodRange(period.input, expression).conditions);
  return `${expression} DESC`;
}

function createJoiner(qn, diagnostics, lines) {
  const aliases = {};
  let next = 1;
  return (parentAlias, refInternal, targetTable) => {
    const key = `${parentAlias}.[${refInternal}]->${targetTable}`;
    if (aliases[key]) return aliases[key];
    const alias = `R${next++}`;
    aliases[key] = alias;
    lines.push(`LEFT JOIN ${qn(targetTable)} AS ${alias} ON ${alias}.[_IDRRef] = ${parentAlias}.[${refInternal}]`);
    diagnostics.push(`JOIN reference: ${parentAlias}.[${refInternal}] -> ${targetTable} AS ${alias}`);
    return alias;
  };
}

function childrenFor(rows, inputChildren) {
  if (inputChildren) return inputChildren;
  return rows.reduce((children, row) => {
    if (row && row.parentId != null) {
      if (!children[row.parentId]) children[row.parentId] = [];
      children[row.parentId].push(row);
    }
    return children;
  }, {});
}

function validIdentifierPart(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));
}

function manualTableName(value, db, schema) {
  const parts = String(value || "").trim().split(".");
  if (!parts.length || parts.some(part => !validIdentifierPart(part))) return null;
  if (parts.length === 1) return qname(db, schema, parts[0]);
  if (parts.length === 2) return qname("", parts[0], parts[1]);
  if (parts.length === 3) return qname(parts[0], parts[1], parts[2]);
  return null;
}

export function generateSql(input) {
  const rows = input.rows || [];
  const byId = input.byId || {};
  const selected = input.selected || {};
  const metaById = input.metaById || {};
  const selectedIds = Object.keys(selected).filter(id => selected[id]);
  if (!selectedIds.length) {
    return { sql: "-- Select at least one field", diagnostics: [], hint: "" };
  }

  const selectedOrig = selectedIds.filter(id => byId[id]).map(id => byId[id]);
  const selectedSynth = selectedIds.filter(id => !byId[id])
    .map(id => ({ id, ...(metaById[id] || {}) }))
    .filter(item => item && item.field);
  const diagnostics = [];
  const db = String(input.dbName || "").trim();
  const schema = String(input.schema || "").trim();
  const selectionContext = resolveSelectionContext([
    ...selectedOrig.map(row => ({ kind: "orig", id: row.id, row })),
    ...selectedSynth.map(meta => ({ kind: "synth", id: meta.id, row: meta.field, meta }))
  ], {
    database: db,
    schema,
    manualFrom: input.fromTable,
    byId,
    rows,
    children: childrenFor(rows, input.children),
    tableFor: row => tableFor(row, byId),
    resolveTablePartHeaderJoin: input.resolveTablePartHeaderJoin
  });

  if (!selectionContext.valid) {
    diagnostics.push(...(selectionContext.diagnostics || []));
    if (!diagnostics.length) diagnostics.push(`Выбор полей заблокирован: ${selectionContext.reason || "unknown_selection_context"}.`);
    return { sql: "", diagnostics, hint: "SQL не сформирован: выбор полей не подтверждён." };
  }

  const periodField = input.periodFieldId ? byId[input.periodFieldId] || null : null;
  const period = buildPeriodContext(input, selectedOrig, periodField, diagnostics);
  const context = {
    input, rows, byId, selectedOrig, selectedSynth,
    boolFilters: input.boolFilters || {}, diagnostics,
    qn: table => qname(db, schema, table), periodField, period, selectionContext, db, schema
  };
  return selectionContext.mode === "manual"
    ? buildExplicitFrom(context)
    : buildResolvedFrom(context);
}

function addColumns(ctx, baseTable, header, aliases, cols, wheres, ensureJoin) {
  const add = (row, meta, tableName) => {
    if (baseTable && tableName !== baseTable && tableName !== header) return;
    let alias = header && tableName === header ? aliases.header : aliases.base;
    if (meta) {
      for (const step of meta.chain || []) alias = ensureJoin(alias, step.refInternal, step.targetTable);
    }
    const field = meta ? meta.field : row;
    const col = field.internal || field.object;
    cols.push(`${castExpr(alias, col, field.type)} AS [${meta ? meta.displayPath : field.title || field.object}]`);
    const filter = boolFilterValueForId(meta ? meta.id : row.id, ctx.boolFilters);
    if (filter !== null && isBoolType(field.type)) wheres.push(`${castExpr(alias, col, field.type)} = ${filter}`);
  };
  ctx.selectedOrig.forEach(row => add(row, null, asTableName(tableFor(row, ctx.byId))));
  ctx.selectedSynth.forEach(meta => {
    const baseTop = ctx.byId[meta.baseTopId];
    if (baseTop) add(null, meta, asTableName(tableFor(baseTop, ctx.byId)));
  });
}

function buildExplicitFrom(ctx) {
  const tableName = manualTableName(ctx.selectionContext.basePhysicalTable, ctx.db, ctx.schema);
  if (!tableName) {
    ctx.diagnostics.push("Ручной FROM не имеет допустимого SQL-идентификатора. SQL намеренно не сформирован.");
    return { sql: "", diagnostics: ctx.diagnostics, hint: "SQL не сформирован." };
  }
  const joins = [], cols = [], wheres = [];
  addColumns(ctx, null, null, { base: "F", header: "F" }, cols, wheres, createJoiner(ctx.qn, ctx.diagnostics, joins));
  if (!cols.length) return { sql: "", diagnostics: [...ctx.diagnostics, "SELECT не сформирован: нет выбранных колонок."], hint: "SQL не сформирован." };
  const orderBy = addPeriodWhere(wheres, "F", ctx.periodField, ctx.period);
  const lines = ["SELECT", `  ${cols.join(",\n  ")}`, `FROM  ${tableName} AS F`];
  if (joins.length) lines.push(...joins);
  if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
  if (orderBy) lines.push(`ORDER BY ${orderBy}`);
  return { sql: lines.join("\n"), diagnostics: ctx.diagnostics, hint: "" };
}

function buildResolvedFrom(ctx) {
  let relationship = null;
  if (ctx.selectionContext.mode === "header_detail") {
    const policy = validateRelationshipForSql(ctx.selectionContext.relationships[0]);
    ctx.diagnostics.push(...policy.diagnostics);
    if (!policy.valid) return { sql: "", diagnostics: ctx.diagnostics, hint: "SQL не сформирован: physical JOIN не подтверждён." };
    relationship = policy.candidate;
  }
  const baseTable = relationship ? relationship.detailTable : ctx.selectionContext.basePhysicalTable;
  const header = relationship ? relationship.headerTable : null;
  const joins = [], cols = [], wheres = [];
  addColumns(ctx, baseTable, header, { base: "T", header: "H" }, cols, wheres, createJoiner(ctx.qn, ctx.diagnostics, joins));
  if (!cols.length) return { sql: "", diagnostics: [...ctx.diagnostics, "SELECT не сформирован: нет выбранных колонок."], hint: "SQL не сформирован." };
  const lines = ["SELECT", `  ${cols.join(",\n  ")}`, `FROM  ${ctx.qn(baseTable)} AS T`];
  if (relationship) {
    lines.push(`LEFT JOIN ${ctx.qn(relationship.headerTable)} AS H ON T.[${relationship.detailForeignKeyColumn}] = H.[${relationship.headerKeyColumn}]`);
    ctx.diagnostics.push(`JOIN header: ${relationship.detailTable}.${relationship.detailForeignKeyColumn} -> ${relationship.headerTable}.${relationship.headerKeyColumn}`);
  }
  if (joins.length) lines.push(...joins);
  if (ctx.period.fieldAvailable && ctx.period.preview.active) {
    const periodTable = asTableName(tableFor(ctx.periodField, ctx.byId));
    if (periodTable === baseTable || periodTable === header) {
      const alias = header && periodTable === header ? "H" : "T";
      const orderBy = addPeriodWhere(wheres, alias, ctx.periodField, ctx.period);
      if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
      if (orderBy) lines.push(`ORDER BY ${orderBy}`);
      return { sql: lines.join("\n"), diagnostics: ctx.diagnostics, hint: "" };
    }
    ctx.diagnostics.push(`Период не применён: поле даты принадлежит ${periodTable || "другой таблице"}.`);
  }
  if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
  return { sql: lines.join("\n"), diagnostics: ctx.diagnostics, hint: "" };
}
