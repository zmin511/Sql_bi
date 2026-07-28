import assert from "node:assert/strict";

import {
  resolveSelectionContext as coreResolveSelectionContext,
  selectionObjectDescriptor as coreSelectionObjectDescriptor
} from "../src/core/selectionContext.js";

import {
  loadProductionRuntime
} from "./helpers/load-production-runtime.js";

import {
  selectionContextScenarios,
  stableSelectionContextResult
} from "./helpers/selection-context-fixtures.js";

const { api } = loadProductionRuntime("index.html");

const scenarios = selectionContextScenarios();
let passed = 0;

for (const scenario of scenarios) {
  const productionResult = api.resolveSelectionContext(
    scenario.selectedFields,
    scenario.context
  );

  const coreResult = coreResolveSelectionContext(
    scenario.selectedFields,
    scenario.context
  );

  assert.deepEqual(
    stableSelectionContextResult(coreResult),
    stableSelectionContextResult(productionResult),
    `Core/production mismatch: ${scenario.name}`
  );

  passed += 1;
  console.log(`ok ${passed} - ${scenario.name}`);
}

{
  const descriptorScenario = scenarios.find(
    scenario =>
      scenario.name ===
      "synthetic field uses base field physical ownership"
  );

  const item = descriptorScenario.selectedFields[0];

  const descriptor = coreSelectionObjectDescriptor(
    item,
    descriptorScenario.context
  );

  assert.equal(descriptor.kind, "synth");
  assert.equal(descriptor.role, "Rn");
  assert.equal(descriptor.table, "_Document100_VT1");
  assert.equal(descriptor.tableId, "detail");
  assert.equal(
    descriptor.physicalKey,
    "umc|dbo|_document100_vt1|Rn"
  );
}

console.log(
  `\n${passed} selection-context parity cases passed`
);
