import assert from "node:assert/strict";
import fs from "node:fs";
import { loadProductionRuntime } from "../tests/helpers/load-production-runtime.js";
import { verify } from "./sync-production-core.mjs";

const html = fs.readFileSync("index.html", "utf8");

assert.match(html, /^\s*<!DOCTYPE html>/i);
assert.match(html, /<meta\s+charset=["']UTF-8["']/i);
assert.match(html, /window\.__SQLBI_TEST__\s*=/);

assert.doesNotMatch(
  html,
  /<script\b[^>]*\bsrc\s*=/i,
  "Portable index.html не должен загружать внешние JavaScript-файлы."
);

assert.doesNotMatch(
  html,
  /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i,
  "Portable index.html не должен загружать внешние таблицы стилей."
);

const { api, source, canonicalCore } = loadProductionRuntime("index.html");
verify(html);
assert.equal(typeof canonicalCore?.buildQueryPlan, "function");
assert.equal(typeof canonicalCore?.generateSql, "function");

new Function(source);

const requiredRuntimeContracts = [
  "normalizeHeader",
  "rowsFromTableObjects",
  "buildTree",
  "tableFor",
  "isSelectableField",
  "getDocPrefix",
  "isVTTableName",
  "parseNumericType",
  "castExpr",
  "sqlDateExpr",
  "buildRelativeDateRange",
  "buildManualDateRange",
  "resolveTablePartHeaderJoin",
  "resolveSelectionContext",
  "createProjectSnapshot",
  "parseProjectSnapshot",
  "createPowerQuery",
  "createPowerQueryExport",
  "renderSQL"
];

for (const name of requiredRuntimeContracts) {
  assert.equal(
    typeof api[name],
    "function",
    `Production runtime должен содержать функцию ${name}.`
  );
}

console.log("ok 1 - portable HTML uses only embedded runtime assets");
console.log("ok 2 - production application script has valid JavaScript syntax");
console.log("ok 3 - test harness reaches required production runtime contracts");
console.log("ok 4 - generated canonical core is synchronized");
console.log("\n4 portable checks passed");
