import assert from "node:assert/strict";
import { parseProjectSnapshot } from "../src/core/project.js";
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
  droppedPeriodFieldId: "",
  recovered: false
});

const repeated = parseProjectSnapshot(JSON.stringify(project));
assert.deepEqual(repeated.loadDiagnostics, canonical.loadDiagnostics);
assert.deepEqual(project.selection.selected, { existing: true, missing: true });

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
