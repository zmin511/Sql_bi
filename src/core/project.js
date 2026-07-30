export const PROJECT_KIND = "sql-bi-project";
export const PROJECT_FORMAT_VERSION = 1;
export const DEFAULT_VISUALIZATION_SETTINGS = Object.freeze({ viewMode: "split", graphFilter: "all" });

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function booleanMap(value) {
  const result = {};
  for (const [key, enabled] of Object.entries(plainObject(value))) {
    if (enabled === true) result[String(key)] = true;
  }
  return result;
}

function boolFilterMap(value) {
  const result = {};
  for (const [key, filter] of Object.entries(plainObject(value))) {
    const source = plainObject(filter);
    const normalized = { yes: source.yes === true, no: source.no === true };
    if (normalized.yes || normalized.no) result[String(key)] = normalized;
  }
  return result;
}

function finiteInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function validIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validSyntheticMetadata(value, physicalIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Array.isArray(value.chain)) return false;
  if (!value.field || typeof value.field !== "object" || Array.isArray(value.field) || !nonEmptyString(value.field.internal)) return false;
  if (value.chain.length && !nonEmptyString(value.baseTopId)) return false;
  if (nonEmptyString(value.baseTopId) && !physicalIds.has(value.baseTopId)) return false;
  return value.chain.every(step => (
    step
    && typeof step === "object"
    && !Array.isArray(step)
    && nonEmptyString(step.refInternal)
    && nonEmptyString(step.targetTable)
    && ["reference", "enum"].includes(step.targetKind)
  ));
}

export function normalizeVisualizationSettings(value) {
  const source = plainObject(value);
  return {
    viewMode: ["tree", "graph", "split"].includes(source.viewMode) ? source.viewMode : DEFAULT_VISUALIZATION_SETTINGS.viewMode,
    graphFilter: ["all", "active", "sql", "errors"].includes(source.graphFilter) ? source.graphFilter : DEFAULT_VISUALIZATION_SETTINGS.graphFilter
  };
}

export function createProjectSnapshot(state, appVersion = "0.2.1") {
  const rows = Array.isArray(state.rows) ? cloneJson(state.rows) : [];
  if (!rows.length) throw new Error("Сначала загрузите структуру MXL/XLSX.");

  const selected = booleanMap(state.selected);
  const synthetic = {};
  for (const id of Object.keys(selected)) {
    if (!state.byId?.[id] && state.metaById?.[id]) synthetic[id] = cloneJson(state.metaById[id]);
  }

  return {
    kind: PROJECT_KIND,
    formatVersion: PROJECT_FORMAT_VERSION,
    appVersion: String(appVersion),
    savedAt: new Date().toISOString(),
    structure: { rows },
    selection: {
      selected,
      synthetic,
      boolFilters: boolFilterMap(state.boolFilters),
      flatten: booleanMap(state.flatten)
    },
    query: {
      serverName: stringValue(state.serverName),
      dbName: stringValue(state.dbName),
      schema: stringValue(state.schema, "dbo"),
      fromTable: stringValue(state.fromTable),
      periodFieldId: stringValue(state.periodFieldId),
      periodMode: state.periodMode === "manual" ? "manual" : "relative",
      dateFrom: validIsoDate(state.dateFrom),
      dateTo: validIsoDate(state.dateTo),
      periodMonths: finiteInteger(state.periodMonths, 3, 0, 1200),
      periodDays: finiteInteger(state.periodDays, 0, 0, 36600),
      periodMonthsFuture: finiteInteger(state.periodMonthsFuture, 0, 0, 1200),
      periodDaysFuture: finiteInteger(state.periodDaysFuture, 0, 0, 36600),
      refDepth: finiteInteger(state.refDepth, 5, 1, 5),
      relationMode: state.relationMode === "warn" ? "warn" : "detail"
    },
    view: {
      search: stringValue(state.search),
      expanded: booleanMap(state.expanded),
      visualization: normalizeVisualizationSettings(state.queryGraph)
    }
  };
}

export function parseProjectSnapshot(input) {
  let project = input;
  if (typeof input === "string") {
    try {
      project = JSON.parse(input);
    } catch {
      throw new Error("Файл проекта содержит некорректный JSON.");
    }
  }
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("Некорректный файл проекта.");
  }
  if (project.kind !== PROJECT_KIND) throw new Error("Это не проект SQL BI.");
  if (project.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error(`Неподдерживаемая версия формата проекта: ${String(project.formatVersion)}.`);
  }

  const rows = project.structure?.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error("В проекте отсутствует структура MXL/XLSX.");
  const rowIds = new Set();
  const normalizedRows = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Некорректная строка структуры проекта: ${index + 1}.`);
    }
    const id = stringValue(row.id);
    if (!id) throw new Error(`В строке структуры ${index + 1} отсутствует ID.`);
    if (rowIds.has(id)) throw new Error(`Проект содержит повторяющийся идентификатор строки: ${id}`);
    rowIds.add(id);
    return cloneJson(row);
  });

  const ids = rowIds;
  const selection = plainObject(project.selection);
  const rawSelected = booleanMap(selection.selected);
  const synthetic = plainObject(selection.synthetic);
  const selected = {};
  const safeSynthetic = {};
  for (const id of Object.keys(rawSelected)) {
    if (ids.has(id)) selected[id] = true;
    else if (validSyntheticMetadata(synthetic[id], ids)) {
      selected[id] = true;
      safeSynthetic[id] = cloneJson(synthetic[id]);
    }
  }

  const query = plainObject(project.query);
  const view = plainObject(project.view);
  const periodFieldId = stringValue(query.periodFieldId);
  const normalizedBoolFilters = boolFilterMap(selection.boolFilters);
  const validFilterIds = new Set([...ids, ...Object.keys(safeSynthetic)]);
  const droppedSelectedIds = Object.keys(rawSelected).filter(id => !own(selected, id)).sort();
  const droppedBoolFilterIds = Object.keys(normalizedBoolFilters).filter(id => !validFilterIds.has(id)).sort();
  const droppedPeriodFieldId = periodFieldId && !ids.has(periodFieldId) ? periodFieldId : "";
  const loadDiagnostics = {
    droppedSelectedIds,
    droppedBoolFilterIds,
    droppedPeriodFieldId,
    recovered: Boolean(droppedSelectedIds.length || droppedBoolFilterIds.length || droppedPeriodFieldId)
  };
  return {
    rows: normalizedRows,
    selected,
    metaById: safeSynthetic,
    boolFilters: Object.fromEntries(Object.entries(normalizedBoolFilters).filter(([id]) => validFilterIds.has(id))),
    flatten: booleanMap(selection.flatten),
    expanded: Object.fromEntries(Object.entries(booleanMap(view.expanded)).filter(([id]) => ids.has(id) || own(safeSynthetic, id))),
    search: stringValue(view.search),
    serverName: stringValue(query.serverName),
    dbName: stringValue(query.dbName),
    schema: stringValue(query.schema, "dbo"),
    fromTable: stringValue(query.fromTable),
    periodFieldId: ids.has(periodFieldId) ? periodFieldId : "",
    periodMode: query.periodMode === "manual" ? "manual" : "relative",
    dateFrom: validIsoDate(query.dateFrom),
    dateTo: validIsoDate(query.dateTo),
    periodMonths: finiteInteger(query.periodMonths, 3, 0, 1200),
    periodDays: finiteInteger(query.periodDays, 0, 0, 36600),
    periodMonthsFuture: finiteInteger(query.periodMonthsFuture, 0, 0, 1200),
    periodDaysFuture: finiteInteger(query.periodDaysFuture, 0, 0, 36600),
    refDepth: finiteInteger(query.refDepth, 5, 1, 5),
    relationMode: query.relationMode === "warn" ? "warn" : "detail"
    ,queryGraph: normalizeVisualizationSettings(view.visualization),
    loadDiagnostics
  };
}
