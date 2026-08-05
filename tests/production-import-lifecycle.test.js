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
const structureA = { worksheet: "TDSheet", headers: ["Объекты", "Внутреннее имя", "Тип", "Уровень"], rows: [["Table A", "_Document901", "", 1], ["Field A", "_Fld901", "string", 2]], tableId: "_Document901", fieldId: "_Fld901" };
const ws = runtime.runtime.XLSX.utils.aoa_to_sheet([structureA.headers, ...structureA.rows]);
const wb = runtime.runtime.XLSX.utils.book_new(); runtime.runtime.XLSX.utils.book_append_sheet(wb, ws, "TDSheet");
const xlsxBuffer = runtime.runtime.XLSX.write(wb, { type: "array", bookType: "xlsx" });
assert.ok(xlsxBuffer.byteLength > 0, "XLSX fixture must have bytes.");
const fileA = { name: "structure-a.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBuffer); } };
const STRUCTURE_B_SHEET_NAME = "TDSheet";
const STRUCTURE_B_HEADERS = ["Объекты", "Внутреннее имя", "Тип", "Уровень"];
const STRUCTURE_B_ROWS = [["Table B", "_Document902", "", 1], ["Field B", "_Fld902", "string", 2]];
const STRUCTURE_B_TABLE_ID = "_Document902";
const STRUCTURE_B_FIELD_ID = "_Fld902";
const wsB = runtime.runtime.XLSX.utils.aoa_to_sheet([STRUCTURE_B_HEADERS, ...STRUCTURE_B_ROWS]);
const wbB = runtime.runtime.XLSX.utils.book_new(); runtime.runtime.XLSX.utils.book_append_sheet(wbB, wsB, STRUCTURE_B_SHEET_NAME);
const xlsxBufferB = runtime.runtime.XLSX.write(wbB, { type: "array", bookType: "xlsx" });
assert.ok(xlsxBufferB.byteLength > 0, "Structure B XLSX fixture must have bytes.");
assert.notDeepEqual(Array.from(new Uint8Array(xlsxBufferB)), Array.from(new Uint8Array(xlsxBuffer)), "Structure B XLSX buffer must differ from Structure A.");
assert.notEqual(STRUCTURE_B_TABLE_ID, structureA.tableId, "Structure B table ID must differ from Structure A.");
assert.notEqual(STRUCTURE_B_FIELD_ID, structureA.fieldId, "Structure B field ID must differ from Structure A.");

const fileB = { name: "structure-b.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBufferB); } };
const importedIds = state => state.rows.map(row => row.internal);
const importedLabels = state => state.rows.map(row => row.object);
const rootIds = state => state.rows.filter(row => row.parentId === null).map(row => row.internal);
let changeAttempts = 0;
const inputValuesAfterAttempts = [];
const invokeImport = async file => {
  changeAttempts += 1;
  input.value = file.name;
  input.files = [file];
  await assert.doesNotReject(() => input.onchange({ target: input }), `Structure ${file.name} import must complete.`);
  inputValuesAfterAttempts.push(input.value);
};

const alertsBeforeValidImports = alerts;
const stateBeforeA = snapshot();
await invokeImport(fileA);
const stateAfterA = snapshot();
const idsAfterA = importedIds(stateAfterA);
const labelsAfterA = importedLabels(stateAfterA);
const rootIdsAfterA = rootIds(stateAfterA);
assert.equal(fileA.readCount, 1, "Structure A file must be read once.");
assert.equal(inputValuesAfterAttempts[0], "", "The structure input must reset after Structure A.");
assert.notDeepEqual(stateAfterA, stateBeforeA, "Structure A must produce one observed state transition.");
assert.ok(idsAfterA.includes(structureA.tableId), "Structure A table ID must be imported.");
assert.ok(idsAfterA.includes(structureA.fieldId), "Structure A field ID must be imported.");
assert.ok(labelsAfterA.includes("Table A"), "Structure A table label must be imported.");
assert.ok(labelsAfterA.includes("Field A"), "Structure A field label must be imported.");
assert.ok(rootIdsAfterA.includes(structureA.tableId), "Structure A table must be the imported root.");

await invokeImport(fileB);
const stateAfterB = snapshot();
const idsAfterB = importedIds(stateAfterB);
const labelsAfterB = importedLabels(stateAfterB);
const rootIdsAfterB = rootIds(stateAfterB);
assert.equal(fileA.readCount, 1, "Structure B import must not reread Structure A.");
assert.equal(fileB.readCount, 1, "Structure B file must be read once.");
assert.equal(inputValuesAfterAttempts[1], "", "The structure input must reset after Structure B.");
assert.notDeepEqual(stateAfterB, stateAfterA, "Structure B must produce one observed state transition.");
assert.equal(alerts, alertsBeforeValidImports, "Valid Structure A and B imports must not raise controlled errors.");
assert.ok(idsAfterB.includes(STRUCTURE_B_TABLE_ID), "Structure B table ID must be imported.");
assert.ok(idsAfterB.includes(STRUCTURE_B_FIELD_ID), "Structure B field ID must be imported.");
assert.ok(!idsAfterB.includes(structureA.tableId), "Structure A table ID must be absent after Structure B replaces it.");
assert.ok(!idsAfterB.includes(structureA.fieldId), "Structure A field ID must be absent after Structure B replaces it.");
assert.ok(labelsAfterB.includes("Table B"), "Structure B table label must be imported.");
assert.ok(labelsAfterB.includes("Field B"), "Structure B field label must be imported.");
assert.ok(!labelsAfterB.includes("Table A"), "Structure A table label must be absent after Structure B replaces it.");
assert.ok(!labelsAfterB.includes("Field A"), "Structure A field label must be absent after Structure B replaces it.");
assert.deepEqual(rootIdsAfterB, [STRUCTURE_B_TABLE_ID], "Structure B must replace the old imported root.");
assert.equal(changeAttempts, 2, "The test-side real-handler helper must make exactly two change attempts.");
assert.deepEqual(new Set(idsAfterB), new Set([STRUCTURE_B_TABLE_ID, STRUCTURE_B_FIELD_ID]), "Final imported IDs must contain Structure B only, without mixed or duplicate rows.");
