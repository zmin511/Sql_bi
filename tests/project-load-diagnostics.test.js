import assert from "node:assert/strict";
import { createProjectSnapshot, parseProjectSnapshot } from "../src/core/project.js";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const project = {
  kind: "sql-bi-project",
  formatVersion: 1,
  structure: {
    rows: [
      { id: "doc", object: "Документ", internal: "_Document1", parentId: null },
      { id: "existing", object: "Сумма", internal: "_Fld1", parentId: "doc" }
    ]
  },
  selection: {
    selected: { existing: true, missing: true },
    boolFilters: { missing: { yes: true } }
  },
  query: { periodFieldId: "missing" }
};

const canonical = parseProjectSnapshot(project);
assert.deepEqual(canonical.selected, { existing: true });
assert.deepEqual(
  canonical.loadDiagnostics,
  {
    droppedSelectedIds: ["missing"],
    droppedBoolFilterIds: ["missing"],
    droppedFilterIds: [],
    droppedPeriodFieldId: "missing",
    recovered: true
  },
  "Parser должен сообщать пользователю обо всех настройках, отброшенных при безопасном восстановлении."
);

const production = loadProductionRuntime().api.parseProjectSnapshot(project);
assert.deepEqual(
  JSON.parse(JSON.stringify(production.loadDiagnostics)),
  canonical.loadDiagnostics,
  "Embedded production runtime должен возвращать тот же recovery summary."
);

const cleanProject = {
  ...project,
  selection: { selected: { existing: true }, boolFilters: {} },
  query: { periodFieldId: "existing" }
};
const clean = parseProjectSnapshot(cleanProject);
assert.deepEqual(clean.loadDiagnostics, {
  droppedSelectedIds: [],
  droppedBoolFilterIds: [],
  droppedFilterIds: [],
  droppedPeriodFieldId: "",
  recovered: false
});

const repeated = parseProjectSnapshot(JSON.stringify(project));
assert.deepEqual(repeated.loadDiagnostics, canonical.loadDiagnostics);
assert.deepEqual(project.selection.selected, { existing: true, missing: true });

const syntheticBooleanState = {
  rows: [
    { id: "doc", object: "Документ", internal: "_Document1", parentId: null },
    { id: "owner", object: "Владелец", internal: "_Fld2RRef", type: "Reference.Owners", parentId: "doc" },
    { id: "owners", object: "Владельцы", internal: "_Reference2", parentId: null }
  ],
  byId: {},
  selected: { syntheticBoolean: true },
  metaById: {
    syntheticBoolean: {
      baseTopId: "owner",
      chain: [{ refInternal: "_Fld2RRef", targetTable: "_Reference2", targetKind: "reference" }],
      field: { object: "Активен", title: "Активен", internal: "_Fld3", type: "bool" },
      displayPath: "Владелец.Активен"
    }
  },
  boolFilters: { syntheticBoolean: { yes: true, no: false } }
};
syntheticBooleanState.byId = Object.fromEntries(syntheticBooleanState.rows.map(row => [row.id, row]));
const syntheticBooleanBefore = structuredClone(syntheticBooleanState);
const syntheticBooleanSnapshot = createProjectSnapshot(syntheticBooleanState, "0.2.2");
const syntheticBooleanRestored = parseProjectSnapshot(syntheticBooleanSnapshot);
const productionSyntheticBooleanRestored = loadProductionRuntime().api.parseProjectSnapshot(syntheticBooleanSnapshot);
assert.deepEqual(syntheticBooleanRestored.selected, { syntheticBoolean: true });
assert.deepEqual(syntheticBooleanRestored.boolFilters, { syntheticBoolean: { yes: true, no: false } });
assert.deepEqual(
  JSON.parse(JSON.stringify(productionSyntheticBooleanRestored.boolFilters)),
  syntheticBooleanRestored.boolFilters,
  "Production project parser должен сохранять тот же synthetic boolean filter, что и canonical parser."
);
assert.deepEqual(syntheticBooleanRestored.loadDiagnostics, {
  droppedSelectedIds: [],
  droppedBoolFilterIds: [],
  droppedFilterIds: [],
  droppedPeriodFieldId: "",
  recovered: false
});
assert.deepEqual(syntheticBooleanState, syntheticBooleanBefore);
assert.equal("loadDiagnostics" in syntheticBooleanSnapshot, false);

const staleSyntheticFilterProject = structuredClone(syntheticBooleanSnapshot);
staleSyntheticFilterProject.selection.selected = {};
staleSyntheticFilterProject.selection.synthetic = {};
const staleSyntheticFilterRestored = parseProjectSnapshot(staleSyntheticFilterProject);
assert.deepEqual(staleSyntheticFilterRestored.boolFilters, {});
assert.deepEqual(staleSyntheticFilterRestored.loadDiagnostics, {
  droppedSelectedIds: [],
  droppedBoolFilterIds: ["syntheticBoolean"],
  droppedFilterIds: [],
  droppedPeriodFieldId: "",
  recovered: true
});

const applied = loadProductionRuntime();
const restored = applied.api.applyProjectSnapshot(project);
assert.equal(restored.loadDiagnostics.recovered, true);
assert.deepEqual(JSON.parse(JSON.stringify(applied.api.state.selected)), { existing: true });

assert.match(
  applied.html,
  /Проект загружен с безопасным восстановлением/,
  "Production UI должен показывать пользователю recovery summary."
);

console.log("7 project load diagnostics tests passed");
