import assert from "node:assert/strict";
import {
  fitColumnAlias as coreFitColumnAlias,
  makeUniqueColumnAlias as coreMakeUniqueColumnAlias,
  outputAliasBase as coreOutputAliasBase,
  qname as coreQname,
  qualifiedColumn as coreQualifiedColumn,
  quoteIdentifier as coreQuoteIdentifier,
  stableAliasHash as coreStableAliasHash
} from "../src/core/sqlIdentifiers.js";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const { api } = loadProductionRuntime("index.html");
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function parity(name, production, core, expected) {
  const productionResult = production();
  const coreResult = core();
  assert.deepEqual(coreResult, productionResult, `${name}: core/production mismatch`);
  assert.deepEqual(productionResult, expected, `${name}: production characterization changed`);
}

for (const item of [
  ["null", null, null],
  ["undefined", undefined, null],
  ["empty", "", null],
  ["whitespace", "   ", null],
  ["ASCII", "_Document100", "[_Document100]"],
  ["Cyrillic", "Документ", "[Документ]"],
  ["spaces", "My table", "[My table]"],
  ["closing bracket", "A]B", "[A]]B]"],
  ["multiple brackets", "]]", "[]]]]]"],
  ["number", 42, "[42]"],
  ["boolean", true, "[true]"],
  ["dotted literal", "schema.table", "[schema.table]"],
  ["SQL fragment literal", "x; SELECT 1", "[x; SELECT 1]"]
]) {
  test(`quoteIdentifier: ${item[0]}`, () => {
    parity(
      `quoteIdentifier ${item[0]}`,
      () => api.quoteIdentifier(item[1]),
      () => coreQuoteIdentifier(item[1]),
      item[2]
    );
  });
}

for (const item of [
  ["F normal", "F", "_Fld1", "F.[_Fld1]"],
  ["T Cyrillic", "T", "Наименование", "T.[Наименование]"],
  ["no alias", "", "_Fld1", "[_Fld1]"],
  ["null alias", null, "_Fld1", "[_Fld1]"],
  ["invalid column", "H", "   ", null],
  ["escaped column", "R1", "A]B", "R1.[A]]B]"],
  ["spaced column", "F", "Поле с пробелом", "F.[Поле с пробелом]"]
]) {
  test(`qualifiedColumn: ${item[0]}`, () => {
    parity(
      `qualifiedColumn ${item[0]}`,
      () => api.qualifiedColumn(item[1], item[2]),
      () => coreQualifiedColumn(item[1], item[2]),
      item[3]
    );
  });
}

for (const item of [
  ["table only", "", "", "_Document100", "[_Document100]"],
  ["schema table", "", "dbo", "_Document100", "[dbo].[_Document100]"],
  ["database schema table", "MyDb", "dbo", "_Document100", "[MyDb].[dbo].[_Document100]"],
  ["blank optional segments", "   ", "", "_Document100", "[_Document100]"],
  ["invalid table", "MyDb", "dbo", " ", null],
  ["dotted table literal", "", "dbo", "schema.table", "[dbo].[schema.table]"],
  ["Cyrillic", "База", "схема", "Таблица", "[База].[схема].[Таблица]"],
  ["bracket", "", "dbo", "A]B", "[dbo].[A]]B]"]
]) {
  test(`qname: ${item[0]}`, () => {
    parity(
      `qname ${item[0]}`,
      () => api.qname(item[1], item[2], item[3]),
      () => coreQname(item[1], item[2], item[3]),
      item[4]
    );
  });
}

for (const item of [
  ["empty", "", "811c9dc5"],
  ["ASCII", "Alias", "22e1f2f7"],
  ["Cyrillic", "Наименование", "568f1a52"],
  ["long", "x".repeat(200), "b3e4b6e5"]
]) {
  test(`stableAliasHash: ${item[0]}`, () => {
    parity(
      `stableAliasHash ${item[0]}`,
      () => api.stableAliasHash(item[1]),
      () => coreStableAliasHash(item[1]),
      item[2]
    );
  });
}

test("stableAliasHash is deterministic and changes with input", () => {
  const first = api.stableAliasHash("Alias");
  assert.equal(api.stableAliasHash("Alias"), first);
  assert.notEqual(api.stableAliasHash("Alias!"), first);
  assert.equal(coreStableAliasHash("Alias"), first);
});

for (const item of [
  ["short", "Alias", "", "Alias"],
  ["exact limit", "a".repeat(128), "", "a".repeat(128)],
  ["over limit", "a".repeat(129), "", `${"a".repeat(119)}~cb62f8ac`],
  ["long with suffix", "a".repeat(129), " (2)", `${"a".repeat(115)}~cb62f8ac (2)`],
  ["suffix too long", "Alias", "x".repeat(128), null]
]) {
  test(`fitColumnAlias: ${item[0]}`, () => {
    parity(
      `fitColumnAlias ${item[0]}`,
      () => api.fitColumnAlias(item[1], item[2]),
      () => coreFitColumnAlias(item[1], item[2]),
      item[3]
    );
  });
}

function uniqueAliasParity(name, values, expected) {
  const productionUsed = new Set();
  const coreUsed = new Set();
  const productionResult = values.map(value => api.makeUniqueColumnAlias(value, productionUsed));
  const coreResult = values.map(value => coreMakeUniqueColumnAlias(value, coreUsed));
  assert.deepEqual(coreResult, productionResult, `${name}: aliases differ`);
  assert.deepEqual(Array.from(coreUsed).sort(), Array.from(productionUsed).sort(), `${name}: used Set differs`);
  assert.deepEqual(productionResult, expected, `${name}: production characterization changed`);
}

test("makeUniqueColumnAlias resolves duplicates and case collisions", () => {
  uniqueAliasParity(
    "duplicate aliases",
    ["Name", "Name", "Name", "name"],
    ["[Name]", "[Name (2)]", "[Name (3)]", "[name (4)]"]
  );
});

test("makeUniqueColumnAlias preserves Cyrillic and escapes brackets", () => {
  uniqueAliasParity(
    "Cyrillic and bracket aliases",
    ["Наименование", "Наименование", "A]B"],
    ["[Наименование]", "[Наименование (2)]", "[A]]B]"]
  );
});

test("makeUniqueColumnAlias resolves long truncated collisions deterministically", () => {
  const long = "a".repeat(129);
  uniqueAliasParity(
    "long duplicate aliases",
    [long, long, long],
    [
      `[${"a".repeat(119)}~cb62f8ac]`,
      `[${"a".repeat(115)}~cb62f8ac (2)]`,
      `[${"a".repeat(115)}~cb62f8ac (3)]`
    ]
  );
});

test("makeUniqueColumnAlias rejects blank alias base", () => {
  uniqueAliasParity("blank alias", [null, "", "   "], [null, null, null]);
});

for (const item of [
  ["display path", { title: "Title", object: "Object", internal: "Internal" }, "Path", "Path"],
  ["title", { title: "Title", object: "Object", internal: "Internal" }, "", "Title"],
  ["object", { title: " ", object: "Object", internal: "Internal" }, "", "Object"],
  ["internal", { title: "", object: null, internal: "Internal" }, "", "Internal"],
  ["none", { title: " ", object: "", internal: null }, "", null]
]) {
  test(`outputAliasBase: ${item[0]}`, () => {
    parity(
      `outputAliasBase ${item[0]}`,
      () => api.outputAliasBase(item[1], item[2]),
      () => coreOutputAliasBase(item[1], item[2]),
      item[3]
    );
  });
}

console.log(`\n${passed} SQL identifier parity tests passed`);
