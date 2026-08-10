import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const runtime = loadProductionRuntime({ includeEmbeddedSheetJs: true });
const input = runtime.elements.get("xlsx");
const alerts = [];
runtime.runtime.alert = message => alerts.push(String(message));
const headers = ["Объекты", "Внутреннее имя", "Тип", "Уровень"];
const snapshot = () => JSON.parse(JSON.stringify(runtime.api.state));
const ids = state => state.rows.map(row => row.internal);

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

const structureA = xlsxFile("structure-a.xlsx", [["Table A", "_Document901", "", 1], ["Field A", "_Fld901", "string", 2]]);
await importFile(structureA);
const before = snapshot();
const headersOnly = xlsxFile("headers-only-structure.xlsx", []);
const parsedRows = runtime.runtime.XLSX.utils.sheet_to_json(
  runtime.runtime.XLSX.read(headersOnly.bytes, { type: "array" }).Sheets.TDSheet,
  { defval: "" }
);
assert.equal(parsedRows.length, 0, "Fixture must be a valid headers-only TDSheet XLSX.");
const alertsBefore = alerts.length;
await importFile(headersOnly);
const after = snapshot();

console.error("EXPECTED RED — CURRENT PRODUCTION VIOLATES ATOMIC EMPTY IMPORT CONTRACT", JSON.stringify({
  beforeRows: before.rows.length,
  beforeIds: ids(before),
  byteLength: headersOnly.bytes.byteLength,
  parsedRows: parsedRows.length,
  readCount: headersOnly.readCount,
  afterRows: after.rows.length,
  afterIds: ids(after),
  alertDelta: alerts.length - alertsBefore,
  inputReset: input.value === "",
  snapshotEqual: JSON.stringify(after) === JSON.stringify(before)
}));

assert.equal(alerts.length, alertsBefore + 1, "Future contract: headers-only XLSX must produce one controlled error.");
assert.deepEqual(after, before, "Future contract: headers-only XLSX must preserve the complete semantic state.");
assert.deepEqual(ids(after), ["_Document901", "_Fld901"], "Future contract: Structure A IDs must remain present.");
