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

const headersOnlyWs = runtime.runtime.XLSX.utils.aoa_to_sheet([structureA.headers]);
const headersOnlyWb = runtime.runtime.XLSX.utils.book_new();
runtime.runtime.XLSX.utils.book_append_sheet(headersOnlyWb, headersOnlyWs, "TDSheet");
const headersOnlyBuffer = runtime.runtime.XLSX.write(headersOnlyWb, { type: "array", bookType: "xlsx" });
const headersOnlyParsedRows = runtime.runtime.XLSX.utils.sheet_to_json(
  runtime.runtime.XLSX.read(headersOnlyBuffer, { type: "array" }).Sheets.TDSheet,
  { defval: "" }
);
assert.equal(headersOnlyParsedRows.length, 0, "Headers-only XLSX fixture must parse to an empty row set.");
const headersOnlyFile = { name: "headers-only-structure.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(headersOnlyBuffer); } };
const headersOnlyBefore = snapshot();
const headersOnlyAlertsBefore = alerts;
await invokeImport(headersOnlyFile);
const headersOnlyAfter = snapshot();
assert.equal(headersOnlyFile.readCount, 1, "Headers-only XLSX must be read once.");
assert.equal(alerts, headersOnlyAlertsBefore + 1, "Headers-only XLSX must emit exactly one controlled semantic-validation error.");
assert.equal(inputValuesAfterAttempts.at(-1), "", "The structure input resets after a headers-only XLSX attempt.");
assert.equal(headersOnlyAfter.rows.length, headersOnlyBefore.rows.length, "Headers-only XLSX must preserve populated runtime rows.");
assert.deepEqual(importedIds(headersOnlyAfter), [structureA.tableId, structureA.fieldId], "Headers-only XLSX must preserve Structure A runtime IDs.");
assert.deepEqual(rootIds(headersOnlyAfter), [structureA.tableId], "Headers-only XLSX must preserve Structure A roots.");
assert.deepEqual(headersOnlyAfter, headersOnlyBefore, "Headers-only XLSX must preserve the complete semantic state.");

await invokeImport(fileB);
const stateAfterB = snapshot();
const idsAfterB = importedIds(stateAfterB);
const labelsAfterB = importedLabels(stateAfterB);
const rootIdsAfterB = rootIds(stateAfterB);
assert.equal(fileA.readCount, 1, "Structure B import must not reread Structure A.");
assert.equal(fileB.readCount, 1, "Structure B file must be read once.");
assert.equal(inputValuesAfterAttempts[1], "", "The structure input must reset after Structure B.");
assert.notDeepEqual(stateAfterB, stateAfterA, "Structure B must produce one observed state transition.");
assert.equal(alerts, alertsBeforeValidImports + 1, "Only the headers-only XLSX must raise a controlled error in this scenario.");
assert.ok(idsAfterB.includes(STRUCTURE_B_TABLE_ID), "Structure B table ID must be imported.");
assert.ok(idsAfterB.includes(STRUCTURE_B_FIELD_ID), "Structure B field ID must be imported.");
assert.ok(!idsAfterB.includes(structureA.tableId), "Structure A table ID must be absent after Structure B replaces it.");
assert.ok(!idsAfterB.includes(structureA.fieldId), "Structure A field ID must be absent after Structure B replaces it.");
assert.ok(labelsAfterB.includes("Table B"), "Structure B table label must be imported.");
assert.ok(labelsAfterB.includes("Field B"), "Structure B field label must be imported.");
assert.ok(!labelsAfterB.includes("Table A"), "Structure A table label must be absent after Structure B replaces it.");
assert.ok(!labelsAfterB.includes("Field A"), "Structure A field label must be absent after Structure B replaces it.");
assert.deepEqual(rootIdsAfterB, [STRUCTURE_B_TABLE_ID], "Structure B must replace the old imported root.");
assert.equal(changeAttempts, 3, "The test-side real-handler helper must make Structure A, headers-only, and Structure B attempts.");
assert.deepEqual(new Set(idsAfterB), new Set([STRUCTURE_B_TABLE_ID, STRUCTURE_B_FIELD_ID]), "Final imported IDs must contain Structure B only, without mixed or duplicate rows.");

const failureRuntime = loadProductionRuntime({ includeEmbeddedSheetJs: true });
const failureInput = failureRuntime.elements.get("xlsx");
const failureAlerts = [];
failureRuntime.runtime.alert = message => { failureAlerts.push(String(message)); };
const failureSnapshot = () => JSON.parse(JSON.stringify(failureRuntime.api.state));
const failureImportedIds = state => state.rows.map(row => row.internal);
const failureRootIds = state => state.rows.filter(row => row.parentId === null).map(row => row.internal);
const failureLabels = state => state.rows.map(row => row.object);
let failureScenarioAttempts = 0;
let failureScenarioSuccessfulImports = 0;
let failureScenarioControlledFailures = 0;
const invokeFailureScenario = async file => {
  failureScenarioAttempts += 1;
  failureInput.value = file.name;
  failureInput.files = [file];
  await assert.doesNotReject(() => failureInput.onchange({ target: failureInput }), `Failure-preservation handler must complete for ${file.name}.`);
};

const preservedBFile = { name: "structure-b-preserved.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBufferB); } };
await invokeFailureScenario(preservedBFile);
const structureBBeforeFailure = failureSnapshot();
const structureBIdsBeforeFailure = failureImportedIds(structureBBeforeFailure);
assert.ok(Object.keys(structureBBeforeFailure).length > 0, "Structure B semantic snapshot must not be empty.");
assert.equal(preservedBFile.readCount, 1, "Structure B must be read once before the failed attempt.");
assert.equal(failureInput.value, "", "The structure input must reset after the preserved Structure B import.");
assert.ok(structureBIdsBeforeFailure.includes(STRUCTURE_B_TABLE_ID), "Structure B table ID must be present before failure.");
assert.ok(structureBIdsBeforeFailure.includes(STRUCTURE_B_FIELD_ID), "Structure B field ID must be present before failure.");
assert.ok(!structureBIdsBeforeFailure.includes(structureA.tableId), "Structure A table ID must be absent before failure.");
assert.ok(!structureBIdsBeforeFailure.includes(structureA.fieldId), "Structure A field ID must be absent before failure.");
failureScenarioSuccessfulImports += 1;

const READ_REJECTION_MARKER = "__LOCAL13C1B1B1_READ_REJECTION__";
const failedReadFile = { name: "structure-read-rejection.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.reject(new Error(READ_REJECTION_MARKER)); } };
const alertsBeforeFailedRead = failureAlerts.length;
const attemptsBeforeFailedRead = failureScenarioAttempts;
failureInput.value = "pending-read-rejection.xlsx";
await invokeFailureScenario(failedReadFile);
const structureBAfterFailure = failureSnapshot();
const structureBIdsAfterFailure = failureImportedIds(structureBAfterFailure);
failureScenarioControlledFailures += 1;
assert.equal(failedReadFile.readCount, 1, "The rejected File-like object must be read once.");
assert.equal(failureAlerts.length, alertsBeforeFailedRead + 1, "The controlled error alert must be emitted exactly once.");
assert.ok(failureAlerts.at(-1).includes(READ_REJECTION_MARKER), "The controlled error alert must contain the exact read rejection marker.");
assert.equal(failureInput.value, "", "The structure input must reset after the rejected read.");
assert.deepEqual(structureBAfterFailure, structureBBeforeFailure, "The complete semantic Structure B snapshot must be preserved after read failure.");
assert.ok(structureBIdsAfterFailure.includes(STRUCTURE_B_TABLE_ID), "Structure B table ID must remain after read failure.");
assert.ok(structureBIdsAfterFailure.includes(STRUCTURE_B_FIELD_ID), "Structure B field ID must remain after read failure.");
assert.ok(!structureBIdsAfterFailure.includes(structureA.tableId), "Structure A table ID must remain absent after read failure.");
assert.ok(!structureBIdsAfterFailure.includes(structureA.fieldId), "Structure A field ID must remain absent after read failure.");
assert.deepEqual(failureRootIds(structureBAfterFailure), failureRootIds(structureBBeforeFailure), "Root IDs must be preserved after read failure.");
assert.deepEqual(failureLabels(structureBAfterFailure), failureLabels(structureBBeforeFailure), "Labels must be preserved after read failure.");
assert.equal(failureScenarioAttempts - attemptsBeforeFailedRead, 1, "The failed read must make exactly one handler attempt.");
assert.equal(failureScenarioAttempts, 2, "The failure scenario must make one successful and one failed attempt.");
assert.equal(failureScenarioSuccessfulImports, 1, "The failed read must not add a successful import.");
assert.equal(failureScenarioControlledFailures, 1, "The failure scenario must have one controlled failure.");

const retryRuntime = loadProductionRuntime({ includeEmbeddedSheetJs: true });
const retryInput = retryRuntime.elements.get("xlsx");
const retryAlerts = [];
retryRuntime.runtime.alert = message => { retryAlerts.push(String(message)); };
const retrySnapshot = () => JSON.parse(JSON.stringify(retryRuntime.api.state));
const retryIds = state => state.rows.map(row => row.internal);
const retryRoots = state => state.rows.filter(row => row.parentId === null).map(row => row.internal);
const retryLabels = state => state.rows.map(row => row.object);
let retryAttempts = 0;
let retrySuccessfulImports = 0;
let retryControlledFailures = 0;
const invokeRetryScenario = async file => {
  retryAttempts += 1;
  retryInput.value = file.name;
  retryInput.files = [file];
  await assert.doesNotReject(() => retryInput.onchange({ target: retryInput }), `Read-failure retry handler must complete for ${file.name}.`);
};

const retryBFile = { name: "structure-b-retry-baseline.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBufferB); } };
await invokeRetryScenario(retryBFile);
const retryBBeforeFailure = retrySnapshot();
assert.equal(retryBFile.readCount, 1, "Retry baseline Structure B must be read once.");
assert.equal(retryInput.value, "", "The retry input must reset after Structure B.");
assert.ok(retryIds(retryBBeforeFailure).includes(STRUCTURE_B_TABLE_ID), "Retry baseline must contain Structure B table ID.");
assert.ok(retryIds(retryBBeforeFailure).includes(STRUCTURE_B_FIELD_ID), "Retry baseline must contain Structure B field ID.");
retrySuccessfulImports += 1;

const RETRY_READ_REJECTION_MARKER = "__LOCAL13C1B1B2_READ_REJECTION__";
const retryFailedFile = { name: "structure-retry-read-rejection.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.reject(new Error(RETRY_READ_REJECTION_MARKER)); } };
const retryAlertsBeforeFailure = retryAlerts.length;
await invokeRetryScenario(retryFailedFile);
const retryBAfterFailure = retrySnapshot();
retryControlledFailures += 1;
assert.equal(retryFailedFile.readCount, 1, "Retry failure File-like object must be read once.");
assert.equal(retryAlerts.length, retryAlertsBeforeFailure + 1, "Retry failure must raise exactly one controlled alert.");
assert.ok(retryAlerts.at(-1).includes(RETRY_READ_REJECTION_MARKER), "Retry failure alert must contain the exact marker.");
assert.equal(retryInput.value, "", "The retry input must reset after the failed read.");
assert.deepEqual(retryBAfterFailure, retryBBeforeFailure, "Structure B must be preserved before retry.");
assert.equal(retrySuccessfulImports, 1, "Read failure must not increment retry successful imports.");

const retryAFile = { name: "structure-a-retry.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBuffer); } };
const retryAlertsBeforeA = retryAlerts.length;
await invokeRetryScenario(retryAFile);
const retryAFinal = retrySnapshot();
const retryFinalIds = retryIds(retryAFinal);
retrySuccessfulImports += 1;
assert.equal(retryAFile.readCount, 1, "Structure A retry file must be read once.");
assert.equal(retryInput.value, "", "The retry input must reset after valid Structure A retry.");
assert.equal(retryAlerts.length, retryAlertsBeforeA, "Valid retry must not raise an additional controlled alert.");
assert.equal(retryAlerts.filter(message => message.includes(RETRY_READ_REJECTION_MARKER)).length, 1, "The stale failure marker must not repeat after valid retry.");
assert.ok(retryFinalIds.includes(structureA.tableId), "Retry must import Structure A table ID.");
assert.ok(retryFinalIds.includes(structureA.fieldId), "Retry must import Structure A field ID.");
assert.ok(!retryFinalIds.includes(STRUCTURE_B_TABLE_ID), "Retry must replace Structure B table ID.");
assert.ok(!retryFinalIds.includes(STRUCTURE_B_FIELD_ID), "Retry must replace Structure B field ID.");
assert.ok(retryLabels(retryAFinal).includes("Table A"), "Retry must retain Structure A table label.");
assert.ok(!retryLabels(retryAFinal).includes("Table B"), "Retry must remove Structure B table label.");
assert.deepEqual(retryRoots(retryAFinal), [structureA.tableId], "Retry must replace the Structure B root with Structure A root.");
assert.deepEqual(new Set(retryFinalIds), new Set([structureA.tableId, structureA.fieldId]), "Final retry state must contain Structure A only.");
assert.equal(retryAttempts, 3, "Retry scenario must make exactly three handler attempts.");
assert.equal(retrySuccessfulImports, 2, "Retry scenario must have two successful imports.");
assert.equal(retryControlledFailures, 1, "Retry scenario must have one controlled failure.");

const parserRuntime = loadProductionRuntime({ includeEmbeddedSheetJs: true });
const parserInput = parserRuntime.elements.get("xlsx");
const parserAlerts = [];
parserRuntime.runtime.alert = message => { parserAlerts.push(String(message)); };
const parserSnapshot = () => JSON.parse(JSON.stringify(parserRuntime.api.state));
const parserIds = state => state.rows.map(row => row.internal);
const parserRoots = state => state.rows.filter(row => row.parentId === null).map(row => row.internal);
let parserAttempts = 0;
let parserSuccessfulImports = 0;
let parserControlledFailures = 0;
const invokeParserScenario = async file => {
  parserAttempts += 1;
  parserInput.value = file.name;
  parserInput.files = [file];
  await assert.doesNotReject(() => parserInput.onchange({ target: parserInput }), `Parser-failure handler must complete for ${file.name}.`);
};

const parserAFile = { name: "structure-a-parser-baseline.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBuffer); } };
await invokeParserScenario(parserAFile);
const parserABeforeFailure = parserSnapshot();
assert.equal(parserAFile.readCount, 1, "Parser baseline Structure A must be read once.");
assert.equal(parserInput.value, "", "Parser input must reset after Structure A.");
assert.ok(parserIds(parserABeforeFailure).includes(structureA.tableId), "Parser baseline must contain Structure A table ID.");
assert.ok(parserIds(parserABeforeFailure).includes(structureA.fieldId), "Parser baseline must contain Structure A field ID.");
parserSuccessfulImports += 1;

const malformedBytes = new Uint8Array([80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
const malformedFile = { name: "malformed-parser-input.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(malformedBytes); } };
const parserAlertsBeforeFailure = parserAlerts.length;
await invokeParserScenario(malformedFile);
const parserAAfterFailure = parserSnapshot();
parserControlledFailures += 1;
assert.equal(malformedFile.readCount, 1, "Malformed File-like object must be read once.");
assert.equal(parserAlerts.length, parserAlertsBeforeFailure + 1, "Parser failure must emit exactly one controlled alert.");
const parserErrorText = parserAlerts.at(-1);
assert.ok(parserErrorText.length > 0, "Parser failure alert must contain the actual production parser error.");
assert.equal(parserInput.value, "", "Parser input must reset after malformed input.");
assert.deepEqual(parserAAfterFailure, parserABeforeFailure, "Structure A semantic snapshot must survive parser failure.");
assert.ok(parserIds(parserAAfterFailure).includes(structureA.tableId), "Structure A table ID must survive parser failure.");
assert.ok(!parserIds(parserAAfterFailure).includes(STRUCTURE_B_TABLE_ID), "Structure B must not appear after parser failure.");
assert.equal(parserSuccessfulImports, 1, "Parser failure must not add a successful import.");

const parserBFile = { name: "structure-b-parser-retry.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(xlsxBufferB); } };
const parserAlertsBeforeRetry = parserAlerts.length;
await invokeParserScenario(parserBFile);
const parserBFinal = parserSnapshot();
const parserFinalIds = parserIds(parserBFinal);
parserSuccessfulImports += 1;
assert.equal(parserBFile.readCount, 1, "Parser retry Structure B must be read once.");
assert.equal(parserInput.value, "", "Parser input must reset after Structure B retry.");
assert.equal(parserAlerts.length, parserAlertsBeforeRetry, "Valid parser retry must not add an alert.");
assert.equal(parserAlerts.filter(message => message === parserErrorText).length, 1, "Stale parser error must not repeat after valid retry.");
assert.ok(parserFinalIds.includes(STRUCTURE_B_TABLE_ID), "Parser retry must import Structure B table ID.");
assert.ok(parserFinalIds.includes(STRUCTURE_B_FIELD_ID), "Parser retry must import Structure B field ID.");
assert.ok(!parserFinalIds.includes(structureA.tableId), "Parser retry must replace Structure A table ID.");
assert.ok(!parserFinalIds.includes(structureA.fieldId), "Parser retry must replace Structure A field ID.");
assert.deepEqual(parserRoots(parserBFinal), [STRUCTURE_B_TABLE_ID], "Parser retry must replace Structure A root.");
assert.equal(parserAttempts, 3, "Parser scenario must make exactly three handler attempts.");
assert.equal(parserSuccessfulImports, 2, "Parser scenario must have two successful imports.");
assert.equal(parserControlledFailures, 1, "Parser scenario must have one controlled parser failure.");
