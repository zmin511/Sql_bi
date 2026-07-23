import assert from "node:assert/strict";
import {
  isSelectableField as coreIsSelectableField
} from "../src/core/selection.js";
import {
  loadProductionRuntime
} from "./helpers/load-production-runtime.js";

const { api } = loadProductionRuntime("index.html");

const cases = [
  {
    name: "missing row",
    row: null,
    context: {},
    expected: false
  },
  {
    name: "ordinary physical field",
    row: { internal: "_Fld123" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: true
  },
  {
    name: "document table",
    row: { internal: "_Document100" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: false
  },
  {
    name: "split document table",
    row: { internal: "_Document100X1" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: false
  },
  {
    name: "tabular section",
    row: { internal: "_Document100_VT200" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: false
  },
  {
    name: "reference table",
    row: { internal: "_Reference184" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: false
  },
  {
    name: "original parent node",
    row: { internal: "_Fld123" },
    context: { kind: "orig", hasOriginalChildren: true },
    expected: false
  },
  {
    name: "synthetic reference field",
    row: { internal: "_Description" },
    context: { kind: "synth", hasOriginalChildren: true },
    expected: true
  },
  {
    name: "identifier field",
    row: { internal: "_IDRRef" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: true
  },
  {
    name: "table-part owner reference field",
    row: { internal: "_Document100_IDRRef" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: true
  },
  {
    name: "missing leading underscore",
    row: { internal: "Fld123" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: false
  },
  {
    name: "invalid physical identifier",
    row: { internal: "_Fld-123" },
    context: { kind: "orig", hasOriginalChildren: false },
    expected: false
  }
];

let passed = 0;

for (const item of cases) {
  const productionResult = api.isSelectableField(
    item.row,
    item.context
  );

  const coreResult = coreIsSelectableField(
    item.row,
    item.context
  );

  assert.equal(
    productionResult,
    item.expected,
    `Unexpected production result: ${item.name}`
  );

  assert.equal(
    coreResult,
    productionResult,
    `Core/production mismatch: ${item.name}`
  );

  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} selection parity cases passed`);