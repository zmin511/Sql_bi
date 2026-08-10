import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const runtime = loadProductionRuntime({ includeEmbeddedSheetJs: true });
const input = runtime.elements.get("xlsx");
const alerts = [];
runtime.runtime.alert = message => alerts.push(String(message));
const headers = ["id", "Объекты", "Внутреннее имя", "Тип", "Уровень"];
const snapshot = () => JSON.parse(JSON.stringify(runtime.api.state));
const internals = state => state.rows.map(row => row.internal);

function xlsxFile(name, rows) {
  const sheet = runtime.runtime.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = runtime.runtime.XLSX.utils.book_new();
  runtime.runtime.XLSX.utils.book_append_sheet(workbook, sheet, "TDSheet");
  const bytes = runtime.runtime.XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name, bytes, readCount: 0, arrayBuffer() { this.readCount += 1; return Promise.resolve(bytes); } };
}

async function importFile(file) {
  input.value = file.name;
  input.files = [file];
  await input.onchange({ target: input });
}

const structureA = xlsxFile("structure-a.xlsx", [
  ["table-a", "Table A", "_Document901", "", 1],
  ["field-a", "Field A", "_Fld901", "string", 2]
]);
await importFile(structureA);
const before = snapshot();

const duplicate = xlsxFile("duplicate-semantic-ids.xlsx", [
  ["dup", "Duplicate Table 901", "_DocumentDUP901", "", 1],
  ["dup", "Duplicate Table 902", "_DocumentDUP902", "", 1]
]);
const parsedRows = runtime.runtime.XLSX.utils.sheet_to_json(
  runtime.runtime.XLSX.read(duplicate.bytes, { type: "array" }).Sheets.TDSheet,
  { defval: "" }
);
assert.equal(parsedRows.length, 2, "Fixture must be a valid two-row TDSheet XLSX.");
assert.deepEqual(Array.from(parsedRows, row => row.id), ["dup", "dup"], "Fixture must retain duplicate explicit logical IDs.");
assert.notEqual(parsedRows[0]["Внутреннее имя"], parsedRows[1]["Внутреннее имя"], "Fixture rows must have distinct internals.");

const alertsBefore = alerts.length;
await importFile(duplicate);
const after = snapshot();

console.error("EXPECTED RED — CURRENT PRODUCTION ACCEPTS DUPLICATE SEMANTIC ROW IDS", JSON.stringify({
  beforeRows: before.rows.length,
  beforeIds: internals(before),
  byteLength: duplicate.bytes.byteLength,
  parsedRows: parsedRows.length,
  logicalIds: Array.from(parsedRows, row => row.id),
  internalIds: Array.from(parsedRows, row => row["Внутреннее имя"]),
  readCount: duplicate.readCount,
  afterRows: after.rows.length,
  duplicateRows: after.rows.filter(row => row.id === "dup").length,
  byIdInternal: after.byId.dup?.internal || null,
  alertDelta: alerts.length - alertsBefore,
  inputReset: input.value === "",
  snapshotEqual: JSON.stringify(after) === JSON.stringify(before),
  structureAIdsPresent: ["_Document901", "_Fld901"].every(id => internals(after).includes(id))
}));

assert.equal(alerts.length, alertsBefore + 1, "Future contract: duplicate semantic IDs must produce one controlled semantic error.");
assert.deepEqual(after, before, "Future contract: duplicate semantic IDs must preserve the complete prior semantic state.");
assert.deepEqual(internals(after), ["_Document901", "_Fld901"], "Future contract: Structure A IDs must remain present.");
assert.equal(after.rows.filter(row => row.id === "dup").length, 0, "Future contract: duplicate state must not be installed.");
