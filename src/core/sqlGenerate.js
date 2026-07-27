import { castExpr } from "./casts.js";
import { buildManualDateRange, buildRelativeDateRange, sqlDateExpr } from "./dates.js";
import { resolveTablePartHeaderJoin } from "./relationships.js";
import { getDocPrefix, isVTTableName, tableFor } from "./tableDetect.js";
import { isBoolType, isDateField } from "./types.js";

export function qname(db, schema, table) {
  const dbPart = db ? `[${db}].` : "";
  const schemaPart = schema ? `[${schema}].` : "";
  return `${dbPart}${schemaPart}[${table}]`;
}

export function boolFilterValueForId(id, boolFilters = {}) {
  const item = boolFilters[id];
  if (!item) return null;
  const yes = !!item.yes;
  const no = !!item.no;
  if (yes && !no) return 1;
  if (no && !yes) return 0;
  return null;
}

export function chainText(chain) {
  return (chain || []).map(step => `${step.refInternal} -> ${step.targetTable}`).join(" / ");
}

function asTableName(row) {
  return String((row && (row.internal || row.object)) || "");
}

function periodSettings(input) {
  return {
    pastMonths: input.periodMonths,
    pastDays: input.periodDays,
    futureMonths: input.periodMonthsFuture,
    futureDays: input.periodDaysFuture
  };
}

function buildSelectedPeriodRange(input, dateExpression) {
  if (input.periodMode === "manual") {
    return buildManualDateRange(
      dateExpression,
      input.dateFrom,
      input.dateTo
    );
  }

  return buildRelativeDateRange(
    periodSettings(input),
    dateExpression
  );
}

function buildPeriodContext(
  input,
  selectedOrig,
  periodField,
  diagnostics
) {
  const preview = buildSelectedPeriodRange(
    input,
    "__DATE__"
  );

  const fieldAvailable =
    !!periodField &&
    selectedOrig.some(row => row.id === periodField.id) &&
    isDateField(periodField);

  (preview.diagnostics || []).forEach(message => {
    diagnostics.push(message);
  });

  if (preview.description) {
    diagnostics.push(preview.description);
  }

  if (
    (preview.active || preview.requested) &&
    !fieldAvailable
  ) {
    diagnostics.push(
      !periodField
        ? "Период не применён: поле периода не выбрано."
        : "Период не применён: поле периода нельзя безопасно использовать в текущем контексте."
    );
  }

  return {
    input,
    preview,
    fieldAvailable
  };
}

function addPeriodWhere(
  wheres,
  alias,
  row,
  period
) {
  if (
    !row ||
    !period.fieldAvailable ||
    !period.preview.active
  ) {
    return "";
  }

  const column = row.internal || row.object;
  const expression = sqlDateExpr(
    alias,
    column,
    row.type
  );

  const range = buildSelectedPeriodRange(
    period.input,
    expression
  );

  wheres.push(...range.conditions);
  return `${expression} DESC`;
}
function createJoiner(qn, diagnostics, lines, aliasPrefix = "R") {
  const map = {};
  let next = 1;

  return (parentAlias, refInternal, targetTable) => {
    const key = `${parentAlias}.[${refInternal}]->${targetTable}`;

    if (map[key]) return map[key];

    const alias = `${aliasPrefix}${next++}`;
    map[key] = alias;

    lines.push(
      `LEFT JOIN ${qn(targetTable)} AS ${alias} ON ${alias}.[_IDRRef] = ${parentAlias}.[${refInternal}]`
    );

    diagnostics.push(
      `JOIN reference: ${parentAlias}.[${refInternal}] -> ${targetTable} AS ${alias}`
    );

    return alias;
  };
}
export function generateSql(input) {
  const rows = input.rows || [];
  const byId = input.byId || {};
  const selected = input.selected || {};
  const metaById = input.metaById || {};
  const boolFilters = input.boolFilters || {};
  const flatten = input.flatten || {};
  const diagnostics = [];
  const selectedIds = Object.keys(selected).filter(id => selected[id]);

  if (!selectedIds.length) {
    return { sql: "-- Select at least one field", diagnostics: [], hint: "" };
  }

  const selectedOrig = selectedIds.filter(id => byId[id]).map(id => byId[id]);
  const selectedSynth = selectedIds
    .filter(id => !byId[id])
    .map(id => ({ id, ...(metaById[id] || {}) }))
    .filter(item => item && item.field);

  const db = String(input.dbName || "").trim();
  const schema = String(input.schema || "").trim();
  const qn = table => qname(db, schema, table);
  const periodField = input.periodFieldId ? byId[input.periodFieldId] || null : null;
  const period = buildPeriodContext(
    input,
    selectedOrig,
    periodField,
    diagnostics
  );

  if (String(input.fromTable || "").trim()) {
    return buildExplicitFrom({
      input,
      selectedOrig,
      selectedSynth,
      boolFilters,
      diagnostics,
      qn,
      periodField,
      period
    });
  }

  return buildDetectedFrom({
    rows,
    byId,
    selectedOrig,
    selectedSynth,
    boolFilters,
    flatten,
    diagnostics,
    qn,
    periodField,
    period,
    relationMode: input.relationMode || "detail"
  });
}

function buildExplicitFrom(ctx) {
  const alias = "F";
  const joins = [];
  const cols = [];
  const wheres = [];
  const ensureJoin = createJoiner(ctx.qn, ctx.diagnostics, joins);

  ctx.selectedOrig.forEach(row => {
    const col = row.internal || row.object;
    cols.push(`${castExpr(alias, col, row.type)} AS [${row.title || row.object}]`);
    const filter = boolFilterValueForId(row.id, ctx.boolFilters);
    if (filter !== null && isBoolType(row.type)) wheres.push(`${castExpr(alias, col, row.type)} = ${filter}`);
  });

  ctx.selectedSynth.forEach(meta => {
    let currentAlias = alias;
    (meta.chain || []).forEach(step => {
      currentAlias = ensureJoin(currentAlias, step.refInternal, step.targetTable);
    });
    const col = meta.field.internal || meta.field.object;
    cols.push(`${castExpr(currentAlias, col, meta.field.type)} AS [${meta.displayPath}]`);
    const filter = boolFilterValueForId(meta.id, ctx.boolFilters);
    if (filter !== null && isBoolType(meta.field.type)) wheres.push(`${castExpr(currentAlias, col, meta.field.type)} = ${filter}`);
  });

  const orderBy = addPeriodWhere(wheres, alias, ctx.periodField, ctx.period);
  const lines = ["SELECT", `  ${cols.join(",\n  ")}`, `FROM  ${ctx.qn(String(ctx.input.fromTable).trim())} AS ${alias}`];
  if (joins.length) lines.push(...joins);
  if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
  if (orderBy) lines.push(`ORDER BY ${orderBy}`);
  return { sql: lines.join("\n"), diagnostics: ctx.diagnostics, hint: "" };
}

function buildDetectedFrom(ctx) {
  const buckets = new Map();
  const addToBucket = (baseRow, origRow, synthMeta) => {
    const tableNode = tableFor(baseRow, ctx.byId);
    const table = asTableName(tableNode);
    const prefix = getDocPrefix(table);
    const key = prefix || table || "__unknown__";
    const bucket = buckets.get(key) || { origRows: [], synthRows: [], tables: new Set(), prefix };
    if (origRow) bucket.origRows.push(origRow);
    if (synthMeta) bucket.synthRows.push(synthMeta);
    if (table) bucket.tables.add(table);
    buckets.set(key, bucket);
  };

  ctx.selectedOrig.forEach(row => addToBucket(row, row, null));
  ctx.selectedSynth.forEach(meta => {
    const baseTop = ctx.byId[meta.baseTopId];
    if (baseTop) addToBucket(baseTop, null, meta);
  });

  if (buckets.size === 1 && buckets.has("__unknown__")) {
    return {
      sql: "-- Specify FROM table in query settings.",
      diagnostics: ["Table for selected fields was not detected automatically."],
      hint: "Specify FROM table to generate SQL exactly."
    };
  }

  const parts = [];
  for (const bucket of buckets.values()) {
    const tables = Array.from(bucket.tables);
    const header = findHeaderTable(bucket.prefix, tables);
    const rest = tables.filter(table => table !== header);
    const headerSelected = !!header && bucketHasHeaderSelection(bucket, header, ctx.byId);

    if (tables.length === 1) {
      ctx.diagnostics.push(`Base table: ${tables[0]}`);
      parts.push(buildForBucket(ctx, bucket, tables[0], false));
    } else if (header) {
      const anyFlatVT = rest.some(table => isVTTableName(table) && !!ctx.flatten[String(table).toLowerCase()] && headerSelected);
      rest.forEach(table => {
        const includeHeader = headerSelected && isVTTableName(table) && !!ctx.flatten[String(table).toLowerCase()];
        ctx.diagnostics.push(includeHeader ? `Flat table: ${table} + header ${header}` : `Table separately: ${table}`);
        parts.push(buildForBucket(ctx, bucket, table, includeHeader));
      });
      if (headerSelected && !anyFlatVT) {
        ctx.diagnostics.push(`Header fields moved to separate SELECT: ${header}`);
        parts.push(buildForBucket(ctx, bucket, header, false));
      }
    } else {
      if (tables.length > 1) ctx.diagnostics.push(`Several tables in one group: ${tables.join(", ")}`);
      tables.forEach(table => {
        ctx.diagnostics.push(`Base table: ${table}`);
        parts.push(buildForBucket(ctx, bucket, table, false));
      });
    }
  }

  addRelationshipDiagnostics(ctx);
  return { sql: parts.join("\n\n-- ##############################################################\n\n"), diagnostics: ctx.diagnostics, hint: "" };
}

function findHeaderTable(prefix, tables) {
  if (!prefix) return null;
  return tables.find(table => !isVTTableName(table) && String(getDocPrefix(table) || "").toLowerCase() === String(prefix).toLowerCase())
    || tables.find(table => String(getDocPrefix(table) || "").toLowerCase() === String(prefix).toLowerCase())
    || null;
}

function bucketHasHeaderSelection(bucket, header, byId) {
  return bucket.origRows.some(row => asTableName(tableFor(row, byId)) === header)
    || bucket.synthRows.some(meta => {
      const baseTop = byId[meta.baseTopId];
      return baseTop && asTableName(tableFor(baseTop, byId)) === header;
    });
}

function buildForBucket(ctx, bucket, baseTable, includeHeader) {
  const H = "H";
  const T = "T";
  const tables = Array.from(bucket.tables);
  const header = findHeaderTable(bucket.prefix, tables);
  const needJoinHeader = includeHeader && header && baseTable !== header;
  const joinLines = [];
  const ensureJoin = createJoiner(ctx.qn, ctx.diagnostics, joinLines);
  const cols = [];
  const wheres = [];
  let orderBy = "";

  bucket.origRows.forEach(row => {
    const tableName = asTableName(tableFor(row, ctx.byId));
    const inThis = baseTable === header ? tableName === header : tableName === baseTable || (includeHeader && header && tableName === header);
    if (!inThis) return;
    const alias = header && tableName === header ? H : T;
    const col = row.internal || row.object;
    cols.push(`${castExpr(alias, col, row.type)} AS [${row.title || row.object}]`);
    const filter = boolFilterValueForId(row.id, ctx.boolFilters);
    if (filter !== null && isBoolType(row.type)) wheres.push(`${castExpr(alias, col, row.type)} = ${filter}`);
  });

  bucket.synthRows.forEach(meta => {
    const baseTop = ctx.byId[meta.baseTopId];
    if (!baseTop) return;
    const baseTopTable = asTableName(tableFor(baseTop, ctx.byId));
    const inThis = baseTable === header ? baseTopTable === header : baseTopTable === baseTable || (includeHeader && header && baseTopTable === header);
    if (!inThis) return;
    let currentAlias = header && baseTopTable === header ? H : T;
    (meta.chain || []).forEach(step => {
      currentAlias = ensureJoin(currentAlias, step.refInternal, step.targetTable);
    });
    const col = meta.field.internal || meta.field.object;
    cols.push(`${castExpr(currentAlias, col, meta.field.type)} AS [${meta.displayPath}]`);
  });

  const lines = ["SELECT", `  ${cols.join(",\n  ")}`];
  if (baseTable === header) {
    lines.push(`FROM  ${ctx.qn(header)} AS ${H}`);
  } else if (needJoinHeader) {
    lines.push(`FROM  ${ctx.qn(baseTable)} AS ${T}`);

    const resolution = resolveTablePartHeaderJoin(
      baseTable,
      {
        rows: ctx.rows,
        expectedHeaderTable: header
      }
    );

    if (!resolution.matched || !resolution.unambiguous) {
      (resolution.diagnostics || []).forEach(message => {
        ctx.diagnostics.push(message);
      });

      (resolution.candidates || []).forEach(candidate => {
        const label =
          `${candidate.detailTable || "<неизвестная таблица>"}.` +
          `${candidate.detailForeignKeyColumn || "<неизвестная колонка>"} -> ` +
          `${candidate.headerTable || "<неизвестная таблица>"}.` +
          `${candidate.headerKeyColumn || "<неизвестная колонка>"}`;

        ctx.diagnostics.push(`Кандидат связи: ${label}.`);
      });

      return null;
    }

    const matchingCandidates = (resolution.candidates || []).filter(candidate =>
      candidate &&
      candidate.detailTable === resolution.detailTable &&
      candidate.detailForeignKeyColumn === resolution.detailForeignKeyColumn &&
      candidate.headerTable === resolution.headerTable &&
      candidate.headerKeyColumn === resolution.headerKeyColumn
    );

    const explicitCandidate =
      matchingCandidates.length === 1 &&
      matchingCandidates[0].confirmation === "explicit_columns"
        ? matchingCandidates[0]
        : null;

    if (!explicitCandidate) {
      (resolution.diagnostics || []).forEach(message => {
        ctx.diagnostics.push(message);
      });

      (resolution.candidates || []).forEach(candidate => {
        const label =
          `${candidate.detailTable || "<unknown table>"}.` +
          `${candidate.detailForeignKeyColumn || "<unknown column>"} -> ` +
          `${candidate.headerTable || "<unknown table>"}.` +
          `${candidate.headerKeyColumn || "<unknown column>"}`;

        ctx.diagnostics.push(
          `Header/detail candidate: ${label}; ` +
          `confirmation=${candidate.confirmation || "<none>"}.`
        );
      });

      ctx.diagnostics.push(
        "The table-part/header relationship was found structurally, " +
        "but the physical detail foreign key column was not confirmed."
      );

      return null;
    }
    lines.push(
      `LEFT JOIN ${ctx.qn(resolution.headerTable)} AS ${H} ` +
      `ON ${T}.[${resolution.detailForeignKeyColumn}] = ` +
      `${H}.[${resolution.headerKeyColumn}]`
    );

    ctx.diagnostics.push(
      `JOIN header: ` +
      `${resolution.detailTable}.${resolution.detailForeignKeyColumn} -> ` +
      `${resolution.headerTable}.${resolution.headerKeyColumn}`
    );
  } else {
    lines.push(`FROM  ${ctx.qn(baseTable)} AS ${T}`);
  }

  lines.push(...joinLines);

  if (
    ctx.period.fieldAvailable &&
    ctx.period.preview.active
  ) {
    const periodTable = asTableName(
      tableFor(ctx.periodField, ctx.byId)
    );

    const belongsToSelect =
      periodTable === baseTable ||
      (
        includeHeader &&
        header &&
        periodTable === header
      );

    if (belongsToSelect) {
      const alias =
        header && periodTable === header
          ? H
          : T;

      orderBy = addPeriodWhere(
        wheres,
        alias,
        ctx.periodField,
        ctx.period
      );
    } else {
      ctx.diagnostics.push(
        `Период не применён к SELECT по ${baseTable}: поле даты принадлежит ${periodTable || "другой таблице"}.`
      );
    }
  }

  if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
  if (orderBy) lines.push(`ORDER BY ${orderBy}`);
  return lines.join("\n");
}


function addRelationshipDiagnostics(ctx) {
  const selectedTables = new Set();
  ctx.selectedOrig.forEach(row => {
    const table = tableFor(row, ctx.byId);
    if (table) selectedTables.add(asTableName(table));
  });
  ctx.selectedSynth.forEach(meta => {
    if ((meta.chain || []).length > 1) {
      ctx.diagnostics.push(`Deep reference chain (${meta.chain.length}): ${chainText(meta.chain)}. Check whether this is 1:1; otherwise rows can multiply.`);
    }
  });
  const vtCount = Array.from(selectedTables).filter(isVTTableName).length;
  if (vtCount > 1) {
    ctx.diagnostics.push(`Several tabular sections selected (${vtCount}). This can be 1:N; keep detail rows unless aggregation is intentional.`);
  }
  if (ctx.relationMode === "warn") {
    ctx.diagnostics.push("1:N mode: warnings only. SQL keeps current detail and does not aggregate rows.");
  } else {
    ctx.diagnostics.push("1:N mode: keep rows. STRING_AGG can be added as an explicit mode later.");
  }
}
