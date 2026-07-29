import { castExpr } from "./casts.js";
import { buildManualDateRange, buildRelativeDateRange, sqlDateExpr } from "./dates.js";
import { validateRelationshipForSql } from "./relationships.js";
import { validateJoinChain } from "./references.js";
import { resolveSelectionContext } from "./selectionContext.js";
import { tableFor } from "./tableDetect.js";
import { isBoolType, isDateField } from "./types.js";
import { qname, qualifiedColumn, outputAliasBase, makeUniqueColumnAlias } from "./sqlIdentifiers.js";

export { qname };

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

function addPeriodWhere(wheres, alias, row, period, diagnostics) {
  if (!row || !period.fieldAvailable || !period.preview.active) return "";
  const expression = sqlDateExpr(alias, row.internal || row.object, row.type);
  if (!expression) {
    diagnostics.push("Период не применён: отсутствует безопасное SQL-имя поля даты.");
    return "";
  }
  wheres.push(...buildSelectedPeriodRange(period.input, expression).conditions);
  return `${expression} DESC`;
}

function createJoiner(qn, diagnostics, lines) {
  const aliases = {};
  let next = 1;
  return (parentAlias, refInternal, targetTable) => {
    const key = `${parentAlias}.${refInternal}->${targetTable}`;
    if (aliases[key]) return aliases[key];
    const alias = `R${next++}`;
    const targetName = qn(targetTable);
    const targetColumn = qualifiedColumn(alias, "_IDRRef");
    const referenceColumn = qualifiedColumn(parentAlias, refInternal);
    if (!targetName || !targetColumn || !referenceColumn) {
      diagnostics.push(`JOIN reference blocked: invalid SQL identifier for ${targetTable || "<empty>"}.`);
      return null;
    }
    aliases[key] = alias;
    lines.push(`LEFT JOIN ${targetName} AS ${alias} ON ${targetColumn} = ${referenceColumn}`);
    diagnostics.push(`JOIN reference: ${parentAlias}.${referenceColumn} -> ${targetTable} AS ${alias}`);
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
  const selectedSynth = [];
  const diagnostics = [];

  for (const id of selectedIds.filter(selectedId => !byId[selectedId])) {
    const meta = metaById[id];

    if (!meta || typeof meta !== "object") {
      diagnostics.push(
        `Synthetic selection blocked for ${id}: missing_metadata / selected_meta_not_found.`
      );

      return {
        sql: "",
        diagnostics,
        hint: "SQL not generated: selected synthetic metadata is missing."
      };
    }

    if (!meta.field || typeof meta.field !== "object") {
      diagnostics.push(
        `Synthetic selection blocked for ${id}: malformed_metadata / missing_field.`
      );

      return {
        sql: "",
        diagnostics,
        hint: "SQL not generated: selected synthetic metadata is malformed."
      };
    }

    const normalizedMeta = { ...meta, id };
    const validation = validateJoinChain(normalizedMeta.chain, {
      rows,
      maxDepth: input.refDepth
    });

    if (!validation.ok) {
      diagnostics.push(
        `Reference chain blocked for ${id}: ` +
        `${validation.status || "unknown"} / ${validation.reason || "invalid_chain"}.`
      );

      return {
        sql: "",
        diagnostics,
        hint: "SQL not generated: selected reference chain is not valid."
      };
    }

    selectedSynth.push(normalizedMeta);
  }

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

  selectedOrig.sort((left, right) =>
    `${asTableName(tableFor(left, byId))}|${left.id}`.localeCompare(
      `${asTableName(tableFor(right, byId))}|${right.id}`
    )
  );
  selectedSynth.sort((left, right) =>
    `${left.baseTopId || ""}|${chainText(left.chain)}|${left.id}`.localeCompare(
      `${right.baseTopId || ""}|${chainText(right.chain)}|${right.id}`
    )
  );

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

function addColumns(ctx, baseTable, header, aliases, cols, wheres, ensureJoin, usedAliases) {
  const add = (row, meta, tableName) => {
    if (baseTable && tableName !== baseTable && tableName !== header) return;
    let alias = header && tableName === header ? aliases.header : aliases.base;
    if (meta) {
      for (const step of meta.chain || []) alias = ensureJoin(alias, step.refInternal, step.targetTable);
    }
    if (!alias) return;
    const field = meta ? meta.field : row;
    const col = field.internal || field.object;
    const expression = castExpr(alias, col, field.type, ctx.diagnostics, field.title || field.object || field.internal);
    if (!expression) {
      ctx.diagnostics.push(`Поле пропущено: отсутствует безопасное SQL-имя колонки.`);
      return;
    }
    const outputAlias = makeUniqueColumnAlias(outputAliasBase(field, meta ? meta.displayPath : ""), usedAliases);
    if (!outputAlias) {
      ctx.diagnostics.push(`Поле пропущено: невозможно сформировать выходной alias.`);
      return;
    }
    cols.push(`${expression} AS ${outputAlias}`);
    const filter = boolFilterValueForId(meta ? meta.id : row.id, ctx.boolFilters);
    if (filter !== null && isBoolType(field.type)) wheres.push(`${expression} = ${filter}`);
  };
  ctx.selectedOrig.forEach(row => add(row, null, asTableName(tableFor(row, ctx.byId))));
  ctx.selectedSynth.forEach(meta => {
    const baseTop = ctx.byId[meta.baseTopId];
    if (baseTop) add(null, meta, asTableName(tableFor(baseTop, ctx.byId)));
  });
}

function buildExplicitFrom(ctx) {
  const tableName = qname(ctx.db, ctx.schema, ctx.selectionContext.basePhysicalTable);
  if (!tableName) {
    ctx.diagnostics.push("Ручной FROM не имеет допустимого SQL-идентификатора. SQL намеренно не сформирован.");
    return { sql: "", diagnostics: ctx.diagnostics, hint: "SQL не сформирован." };
  }
  const joins = [], cols = [], wheres = [], usedAliases = new Set();
  addColumns(ctx, null, null, { base: "F", header: "F" }, cols, wheres, createJoiner(ctx.qn, ctx.diagnostics, joins), usedAliases);
  if (!cols.length) return { sql: "", diagnostics: [...ctx.diagnostics, "SELECT не сформирован: нет выбранных колонок."], hint: "SQL не сформирован." };
  const orderBy = addPeriodWhere(wheres, "F", ctx.periodField, ctx.period, ctx.diagnostics);
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
  const joins = [], cols = [], wheres = [], usedAliases = new Set();
  addColumns(ctx, baseTable, header, { base: "T", header: "H" }, cols, wheres, createJoiner(ctx.qn, ctx.diagnostics, joins), usedAliases);
  if (!cols.length) return { sql: "", diagnostics: [...ctx.diagnostics, "SELECT не сформирован: нет выбранных колонок."], hint: "SQL не сформирован." };
  const baseName = ctx.qn(baseTable);
  if (!baseName) return { sql: "", diagnostics: [...ctx.diagnostics, "FROM не сформирован: отсутствует безопасное имя таблицы."], hint: "SQL не сформирован." };
  const lines = ["SELECT", `  ${cols.join(",\n  ")}`, `FROM  ${baseName} AS T`];
  if (relationship) {
    const headerName = ctx.qn(relationship.headerTable);
    const detailColumn = qualifiedColumn("T", relationship.detailForeignKeyColumn);
    const headerColumn = qualifiedColumn("H", relationship.headerKeyColumn);
    if (!headerName || !detailColumn || !headerColumn) return { sql: "", diagnostics: [...ctx.diagnostics, "JOIN шапки не сформирован: отсутствует безопасный SQL-идентификатор."], hint: "SQL не сформирован." };
    lines.push(`LEFT JOIN ${headerName} AS H ON ${detailColumn} = ${headerColumn}`);
    ctx.diagnostics.push(`JOIN header: ${relationship.detailTable}.${relationship.detailForeignKeyColumn} -> ${relationship.headerTable}.${relationship.headerKeyColumn}`);
  }
  if (joins.length) lines.push(...joins);
  if (ctx.period.fieldAvailable && ctx.period.preview.active) {
    const periodTable = asTableName(tableFor(ctx.periodField, ctx.byId));
    if (periodTable === baseTable || periodTable === header) {
      const alias = header && periodTable === header ? "H" : "T";
      const orderBy = addPeriodWhere(wheres, alias, ctx.periodField, ctx.period, ctx.diagnostics);
      if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
      if (orderBy) lines.push(`ORDER BY ${orderBy}`);
      return { sql: lines.join("\n"), diagnostics: ctx.diagnostics, hint: "" };
    }
    ctx.diagnostics.push(`Период не применён: поле даты принадлежит ${periodTable || "другой таблице"}.`);
  }
  if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
  return { sql: lines.join("\n"), diagnostics: ctx.diagnostics, hint: "" };
}
