import assert from "node:assert/strict";
import { parseProjectSnapshot } from "../src/core/project.js";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  console.log(`ok ${++passed} - ${name}`);
};

const row = (id, object = "Документ") => ({
  id,
  object,
  internal: `_Document_${id}`,
  parentId: null
});

const syntheticMeta = (baseTopId = "orders") => ({
  baseTopId,
  chain: [{
    refInternal: "_FldCustomer",
    targetTable: "_ReferenceCustomers",
    targetKind: "reference"
  }],
  field: { internal: "_FldName", title: "Наименование", type: "string" }
});

const snapshot = overrides => ({
  kind: "sql-bi-project",
  formatVersion: 1,
  structure: { rows: [row("orders")] },
  selection: { selected: {}, synthetic: {}, boolFilters: {} },
  ...overrides
});

test("canonical parser rejects duplicate physical row ids without mutating input", () => {
  const input = snapshot({
    structure: { rows: [row("duplicate"), row("duplicate")] },
    selection: { selected: { duplicate: true } }
  });
  const before = structuredClone(input);
  assert.throws(
    () => parseProjectSnapshot(input),
    /Проект содержит повторяющийся идентификатор строки: duplicate/
  );
  assert.deepEqual(input, before);
});

test("duplicate ids remain invalid when row types differ", () => {
  const input = snapshot({
    structure: { rows: [row("duplicate", "Документ"), row("duplicate", "Справочник")] }
  });
  assert.throws(
    () => parseProjectSnapshot(input),
    /Проект содержит повторяющийся идентификатор строки: duplicate/
  );
});

test("unique physical row ids remain valid", () => {
  const parsed = parseProjectSnapshot(snapshot({
    structure: { rows: [row("orders"), row("customers")] }
  }));
  assert.deepEqual(parsed.rows.map(item => item.id), ["orders", "customers"]);
  assert.equal(parsed.loadDiagnostics.recovered, false);
});

const malformedSynthetic = [
  ["missing baseTopId", { chain: syntheticMeta().chain, field: syntheticMeta().field }],
  ["missing field", { baseTopId: "orders", chain: syntheticMeta().chain }],
  ["invalid field", { baseTopId: "orders", chain: syntheticMeta().chain, field: {} }],
  ["chain is not an array", { baseTopId: "orders", chain: {}, field: syntheticMeta().field }],
  ["malformed chain step", {
    baseTopId: "orders",
    chain: [{ refInternal: "_FldCustomer", targetKind: "reference" }],
    field: syntheticMeta().field
  }]
];

for (const [label, metadata] of malformedSynthetic) {
  test(`malformed synthetic metadata is dropped fail-closed: ${label}`, () => {
    const input = snapshot({
      selection: {
        selected: { synthetic: true },
        synthetic: { synthetic: metadata },
        boolFilters: { synthetic: { yes: true } }
      }
    });
    const before = structuredClone(input);
    const parsed = parseProjectSnapshot(input);
    assert.deepEqual(parsed.selected, {});
    assert.deepEqual(parsed.metaById, {});
    assert.deepEqual(parsed.boolFilters, {});
    assert.deepEqual(parsed.loadDiagnostics.droppedSelectedIds, ["synthetic"]);
    assert.deepEqual(parsed.loadDiagnostics.droppedBoolFilterIds, ["synthetic"]);
    assert.equal(parsed.loadDiagnostics.recovered, true);
    assert.deepEqual(input, before);
  });
}

test("synthetic metadata with a missing physical base row is dropped", () => {
  const parsed = parseProjectSnapshot(snapshot({
    selection: {
      selected: { synthetic: true },
      synthetic: { synthetic: syntheticMeta("missing") },
      boolFilters: { synthetic: { no: true } }
    }
  }));
  assert.deepEqual(parsed.selected, {});
  assert.deepEqual(parsed.boolFilters, {});
  assert.deepEqual(parsed.loadDiagnostics.droppedSelectedIds, ["synthetic"]);
  assert.deepEqual(parsed.loadDiagnostics.droppedBoolFilterIds, ["synthetic"]);
});

test("valid historical empty-chain metadata and boolean filter survive", () => {
  const metadata = {
    field: { internal: "_FldSynthetic", type: "bool" },
    chain: []
  };
  const parsed = parseProjectSnapshot(snapshot({
    selection: {
      selected: { synthetic: true },
      synthetic: { synthetic: metadata },
      boolFilters: { synthetic: { yes: true } }
    }
  }));
  assert.deepEqual(parsed.selected, { synthetic: true });
  assert.deepEqual(parsed.metaById, { synthetic: metadata });
  assert.deepEqual(parsed.boolFilters, { synthetic: { yes: true, no: false } });
  assert.equal(parsed.loadDiagnostics.recovered, false);
});

test("production application rejects duplicate ids before changing state", () => {
  const value = loadProductionRuntime();
  const before = {
    rows: structuredClone(value.api.state.rows),
    selected: structuredClone(value.api.state.selected),
    metaById: structuredClone(value.api.state.metaById)
  };
  const input = snapshot({
    structure: { rows: [row("duplicate"), row("duplicate")] },
    selection: { selected: { duplicate: true } }
  });
  assert.throws(
    () => value.api.applyProjectSnapshot(input),
    /Проект содержит повторяющийся идентификатор строки: duplicate/
  );
  assert.deepEqual(structuredClone(value.api.state.rows), before.rows);
  assert.deepEqual(structuredClone(value.api.state.selected), before.selected);
  assert.deepEqual(structuredClone(value.api.state.metaById), before.metaById);
});

test("canonical and embedded production parsers agree on recovery", () => {
  const input = snapshot({
    selection: {
      selected: { synthetic: true },
      synthetic: { synthetic: { unexpected: true } },
      boolFilters: { synthetic: { yes: true } }
    }
  });
  const canonical = parseProjectSnapshot(input);
  const production = loadProductionRuntime().api.parseProjectSnapshot(input);
  assert.deepEqual(JSON.parse(JSON.stringify(production)), canonical);
});

console.log(`\n${passed} project corruption validation tests passed`);
