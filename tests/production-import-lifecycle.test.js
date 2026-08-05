import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

// LOCAL13B expected-red characterization. This invokes the onchange function
// extracted from the actual production index.html runtime; it does not copy it.
const runtime = loadProductionRuntime();
const input = runtime.elements.get("xlsx");
const marker = "__LOCAL13B_ARRAY_BUFFER_REJECTION__";
let alerts = 0;
runtime.runtime.alert = () => { alerts += 1; };

input.value = "selected-structure.xlsx";
const rejectedFile = {
  name: "selected-structure.xlsx",
  arrayBuffer() { return Promise.reject(new Error(marker)); }
};
input.files = [rejectedFile];
const snapshot = () => JSON.parse(JSON.stringify(runtime.api.state));
const before = snapshot();

await assert.doesNotReject(
  () => input.onchange({ target: input }),
  "A File.arrayBuffer() failure must use the controlled import-error path."
);

assert.equal(alerts, 1, "The controlled import-error alert must be shown exactly once.");
assert.equal(input.value, "", "The structure input must be reset after a failed attempt.");
assert.deepEqual(snapshot(), before, "A failed read must preserve the existing production state.");
