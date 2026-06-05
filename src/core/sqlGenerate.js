import { castExpr } from "./casts.js";
import { relativeDateBoundary } from "./dates.js";
import { getDocPrefix, isVTTableName, tableFor } from "./tableDetect.js";
import { isBoolType } from "./types.js";

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

function periodOptions(input) {
  return {
    pastMonths: Math.max(0, Number(input.periodMonths || 0)) || 0,
    pastDays: Math.max(0, Number(input.periodDays || 0)) || 0,
    futureMonths: Math.max(0, Number(input.periodMonthsFuture || 0)) || 0,
    futureDays: Math.max(0, Number(input.periodDaysFuture || 0)) || 0
  };
}

function hasPeriod(opts) {
  return opts.pastMonths > 0 || opts.pastDays > 0 || opts.futureMonths > 0 || opts.futureDays > 0;
}

function dateExpr(alias, row) {
  const col = row.internal || row.object;
  const isDate = /_Date_Time$/i.test(col) || col === "_Date_Time" || /date|datetime/i.test(String(row.type || "").toLowerCase()) || /дата/i.test(String(row.type || ""));
  return isDate ? `DATEADD(YEAR, -2000, ${alias}.[${col}])` : `${alias}.[${col}]`;
}

function addPeriodWhere(wheres, alias, row, opts) {
  if (!row || !hasPeriod(opts)) return "";
  const expr = dateExpr(alias, row);
  if (opts.pastMonths > 0 || opts.pastDays > 0) wheres.push(`${expr} >= ${relativeDateBoundary(opts.pastMonths, opts.pastDays, "past")}`);
  if (opts.futureMonths > 0 || opts.futureDays > 0) wheres.push(`${expr} <= ${relativeDateBoundary(opts.futureMonths, opts.futureDays, "future")}`);
  return `${expr} DESC`;
}

function createJoiner(qn, diagnostics, lines, aliasPrefix = "R") {
  const map = {};
  let next = 1;
  return (parentAlias, refInternal, targetTable) => {
    const key = `${parentAlias}.[${refInternal}]->${targetTable}`;
    if (map[key]) return map[key];
    const alias = `${aliasPrefix}${next++}`;
    map[key] = alias;
    lines.push(`LEFT JOIN ${qn(targetTable)} AS ${alias} ON ${alias}.[_IDRRef] = ${parentAlias}.[${refInternal}]`);
    diagnostics.push(`JOIN reference: ${parentAlias}.[${refInternal}] -> ${targetTable} AS ${alias}`);
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
  const opts = periodOptions(input);

  if (String(input.fromTable || "").trim()) {
    return buildExplicitFrom({
      input,
      selectedOrig,
      selectedSynth,
      boolFilters,
      diagnostics,
      qn,
      periodField,
      opts
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
    opts,
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

  const orderBy = addPeriodWhere(wheres, alias, ctx.periodField, ctx.opts);
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
    const joinCol = findHeaderJoinColumn(ctx.rows, ctx.byId, baseTable, bucket.prefix, header);
    lines.push(`LEFT JOIN ${ctx.qn(header)} AS ${H} ON ${T}.[${joinCol}] = ${H}.[_IDRRef]`);
    ctx.diagnostics.push(`JOIN header: ${baseTable}.${joinCol} -> ${header}._IDRRef`);
  } else {
    lines.push(`FROM  ${ctx.qn(baseTable)} AS ${T}`);
  }

  lines.push(...joinLines);

  if (ctx.periodField && hasPeriod(ctx.opts)) {
    const periodTable = asTableName(tableFor(ctx.periodField, ctx.byId));
    if (periodTable === baseTable || (header && periodTable === header)) {
      const alias = header && periodTable === header ? H : T;
      orderBy = addPeriodWhere(wheres, alias, ctx.periodField, ctx.opts);
    }
  }

  if (wheres.length) lines.push(`WHERE ${wheres.join(" AND ")}`);
  if (orderBy) lines.push(`ORDER BY ${orderBy}`);
  return lines.join("\n");
}

function findHeaderJoinColumn(rows, byId, baseTable, prefix, header) {
  const internals = new Set(rows
    .filter(row => asTableName(tableFor(row, byId)) === baseTable)
    .map(row => String(row.internal || row.object || "").toLowerCase()));
  const candidates = [
    `${prefix}_IDRRef`,
    `${String(prefix || "").replace(/X\d+$/i, "")}_IDRRef`,
    `${String(header || "").replace(/X\d+$/i, "")}_IDRRef`,
    `${String(header || "").replace(/.*\./, "")}_IDRRef`
  ].filter(Boolean);
  const lowered = candidates.map(item => String(item).toLowerCase());
  const found = lowered.find(item => internals.has(item));
  return candidates[lowered.indexOf(found)] || candidates[0];
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
