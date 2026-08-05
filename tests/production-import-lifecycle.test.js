import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

// LOCAL13B expected-red characterization. This invokes the onchange function
// extracted from the actual production index.html runtime; it does not copy it.
assert.equal(loadProductionRuntime().runtime.XLSX, undefined, "Default loader must not evaluate embedded SheetJS.");
const runtime = loadProductionRuntime({ includeEmbeddedSheetJs: true });
assert.equal(typeof runtime.runtime.XLSX?.read, "function", "Opt-in loader must expose embedded SheetJS.");
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

const rows = [{ id: "A", object: "Table A", internal: "_Document901", parentId: null }, { id: "AF", object: "Field A", internal: "_Fld901", type: "string", parentId: "A" }];
const ws = runtime.runtime.XLSX.utils.aoa_to_sheet([["Объекты", "Внутреннее имя", "Тип", "Уровень"], ["Table A", "_Document901", "", 1], ["Field A", "_Fld901", "string", 2]]);
const wb = runtime.runtime.XLSX.utils.book_new(); runtime.runtime.XLSX.utils.book_append_sheet(wb, ws, "TDSheet");
input.value = "valid.xlsx"; input.files = [{ name: "valid.xlsx", arrayBuffer: () => Promise.resolve(runtime.runtime.XLSX.write(wb, { type: "array", bookType: "xlsx" })) }];
await assert.doesNotReject(() => input.onchange({ target: input }));
assert.equal(input.value, ""); assert.ok(runtime.api.state.rows.some(row => row.internal === "_Document901"));
