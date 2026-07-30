import assert from "node:assert/strict";
import { parseProjectSnapshot as canonicalParse } from "../src/core/project.js";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  console.log(`ok ${++passed} - ${name}`);
};

const value = loadProductionRuntime();
const calls = { parse: 0, build: 0 };
const originalParse = value.canonicalCore.parseProjectSnapshot;
const originalBuild = value.canonicalCore.createProjectSnapshot;

test("embedded canonical core exports project persistence API", () => {
  assert.equal(typeof originalParse, "function");
  assert.equal(typeof originalBuild, "function");
});

value.canonicalCore.parseProjectSnapshot = (...args) => {
  calls.parse += 1;
  return originalParse(...args);
};
value.canonicalCore.createProjectSnapshot = (...args) => {
  calls.build += 1;
  return originalBuild(...args);
};

const snapshot = {
  kind: "sql-bi-project",
  formatVersion: 1,
  structure: {
    rows: [
      { id: "doc", object: "Документ", internal: "_Document1", parentId: null },
      { id: "field", object: "Флаг", internal: "_Fld1", type: "bool", parentId: "doc" }
    ]
  },
  selection: { selected: { field: true }, boolFilters: { field: { yes: true } } }
};

test("production project load delegates to canonical parser", () => {
  value.api.applyProjectSnapshot(snapshot);
  assert.equal(calls.parse, 1);
});

const saved = value.api.createProjectSnapshot();
test("production project save delegates to canonical serializer", () => assert.equal(calls.build, 1));

test("production application contains no duplicate persistence definitions", () => {
  assert.doesNotMatch(value.source, /function\s+parseProjectSnapshot\s*\(/);
  assert.doesNotMatch(value.source, /function\s+createProjectSnapshot\s*\(/);
  assert.doesNotMatch(value.source, /const\s+project(?:PlainObject|String|Clone|BooleanMap|BoolFilters|Integer|Date)\b/);
  assert.doesNotMatch(value.source, /const\s+normalizeVisualizationSettings\s*=/);
});

test("save and load round-trip matches canonical normalized state", () => {
  const production = value.api.parseProjectSnapshot(JSON.parse(JSON.stringify(saved)));
  const canonical = canonicalParse(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(production)), canonical);
});

test("synthetic boolean filters survive canonical production delegation", () => {
  const synthetic = structuredClone(snapshot);
  synthetic.selection = {
    selected: { syntheticFlag: true },
    synthetic: { syntheticFlag: { field: { internal: "_FldSynthetic", type: "bool" }, chain: [] } },
    boolFilters: { syntheticFlag: { yes: true } }
  };
  const restored = value.api.applyProjectSnapshot(synthetic);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.boolFilters)), { syntheticFlag: { yes: true, no: false } });
  assert.equal(restored.loadDiagnostics.recovered, false);
});

test("canonical diagnostics reach production unchanged", () => {
  const stale = structuredClone(snapshot);
  stale.selection = { selected: { missing: true }, boolFilters: { missing: { no: true } } };
  stale.query = { periodFieldId: "missing" };
  const restored = value.api.applyProjectSnapshot(stale);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.loadDiagnostics)), canonicalParse(stale).loadDiagnostics);
});

test("serialized snapshot keeps format 1 and excludes derived state", () => {
  value.api.state.queryPlan = { unsafe: true };
  value.api.state.queryResult = { unsafe: true };
  value.api.state.loadDiagnostics = { unsafe: true };
  const output = value.api.createProjectSnapshot();
  assert.equal(output.formatVersion, 1);
  assert.equal("queryPlan" in output, false);
  assert.equal("queryResult" in output, false);
  assert.equal("loadDiagnostics" in output, false);
});

test("missing canonical project API fails closed without legacy fallback", () => {
  const isolated = loadProductionRuntime();
  delete isolated.canonicalCore.parseProjectSnapshot;
  assert.throws(() => isolated.api.applyProjectSnapshot(snapshot), /Встроенное ядро проектов SQL BI недоступно/);
  delete isolated.canonicalCore.createProjectSnapshot;
  assert.throws(() => isolated.api.createProjectSnapshot(), /Встроенное ядро проектов SQL BI недоступно/);
});

test("raw production HTML does not publish VM test hooks", () => {
  assert.doesNotMatch(value.html, /window\.__SQLBI_TEST__/);
  assert.equal(loadProductionRuntime({ instrument: false }).api, null);
});

console.log(`\n${passed} project persistence parity tests passed`);
