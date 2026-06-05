import assert from "node:assert/strict";
import { normalizeHeader, rowsFromTableObjects } from "../src/core/normalize.js";
import { attachParentsFromLevels, buildTree } from "../src/core/tree.js";
import { getDocPrefix, isVTTableName, tableFor } from "../src/core/tableDetect.js";
import { isBoolType, isDateField, isReferenceField, isReferenceType } from "../src/core/types.js";
import { sqlDateExpr, relativeDateBoundary } from "../src/core/dates.js";
import { castExpr } from "../src/core/casts.js";
import { generateSql, qname } from "../src/core/sqlGenerate.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("normalizeHeader maps Russian structure headers", () => {
  assert.equal(normalizeHeader("Объекты"), "object");
  assert.equal(normalizeHeader("Тип"), "type");
  assert.equal(normalizeHeader("Внутреннее имя"), "internal");
  assert.equal(normalizeHeader("Уровень"), "level");
});

test("rowsFromTableObjects creates Row objects", () => {
  const rows = rowsFromTableObjects([{ "Объекты": "Дата", "Тип": "ДатаВремя", "Внутреннее имя": "_Date_Time", "Уровень": 2 }]);
  assert.deepEqual(rows[0], {
    id: "1",
    object: "Дата",
    type: "ДатаВремя",
    internal: "_Date_Time",
    title: undefined,
    parentId: null,
    level: 2
  });
});

test("attachParentsFromLevels restores tree hierarchy", () => {
  const rows = [
    { id: "1", object: "Документы", level: 0, parentId: null },
    { id: "2", object: "ОказаниеУслуг", level: 1, parentId: null },
    { id: "3", object: "Дата", level: 2, parentId: null }
  ];
  attachParentsFromLevels(rows);
  assert.equal(rows[1].parentId, "1");
  assert.equal(rows[2].parentId, "2");
});

test("buildTree groups roots and children", () => {
  const rows = [
    { id: "1", object: "Root", parentId: null },
    { id: "2", object: "Child", parentId: "1" }
  ];
  const tree = buildTree(rows);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.children["1"][0].id, "2");
});

test("table detection prioritizes tabular sections", () => {
  const rows = [
    { id: "1", object: "Document", internal: "_Document100", parentId: null },
    { id: "2", object: "Items", internal: "_Document100_VT200", parentId: "1" },
    { id: "3", object: "Quantity", internal: "_Fld300", parentId: "2" }
  ];
  const { byId } = buildTree(rows);
  assert.equal(tableFor(rows[2], byId).internal, "_Document100_VT200");
});

test("getDocPrefix and isVTTableName support 1C names", () => {
  assert.equal(isVTTableName("_Document100_VT200"), true);
  assert.equal(getDocPrefix("_Document100_VT200"), "_Document100");
  assert.equal(getDocPrefix("_Reference184X1"), "_Reference184");
});

test("type helpers detect references, booleans, and dates", () => {
  assert.equal(isReferenceType("Справочник.Клиенты"), true);
  assert.equal(isReferenceField({ internal: "_Fld123RRef" }), true);
  assert.equal(isBoolType("Булево"), true);
  assert.equal(isDateField({ object: "Дата", type: "ДатаВремя", internal: "_Date_Time" }), true);
});

test("date expressions handle 1C offset and relative periods", () => {
  assert.equal(sqlDateExpr("T", "_Date_Time"), "DATEADD(YEAR, -2000, T.[_Date_Time])");
  assert.equal(relativeDateBoundary(2, 10, "past"), "DATEADD(DAY, -10, DATEADD(MONTH, -2, GETDATE()))");
  assert.equal(relativeDateBoundary(1, 5, "future"), "DATEADD(DAY, 5, DATEADD(MONTH, 1, GETDATE()))");
});

test("castExpr handles UUID, bool, int, and date fields", () => {
  assert.equal(castExpr("T", "_IDRRef", ""), "CAST(T.[_IDRRef] AS uniqueidentifier)");
  assert.equal(castExpr("T", "_Fld123RRef", "Справочник.Клиенты"), "CAST(T.[_Fld123RRef] AS uniqueidentifier)");
  assert.equal(castExpr("T", "_Posted", "Булево"), "CAST(T.[_Posted] AS int)");
  assert.equal(castExpr("T", "_Number", "int"), "CAST(T.[_Number] AS int)");
  assert.equal(castExpr("T", "_Date_Time", "ДатаВремя"), "DATEADD(YEAR, -2000, T.[_Date_Time])");
});

test("qname formats optional database and schema", () => {
  assert.equal(qname("MyDb", "dbo", "_Document100"), "[MyDb].[dbo].[_Document100]");
  assert.equal(qname("", "dbo", "_Document100"), "[dbo].[_Document100]");
});

test("generateSql supports explicit FROM with bool and date filters", () => {
  const rows = [
    { id: "1", object: "Posted", title: "Posted", internal: "_Posted", type: "boolean", parentId: null },
    { id: "2", object: "Date", title: "Date", internal: "_Date_Time", type: "datetime", parentId: null }
  ];
  const { sql } = generateSql({
    rows,
    byId: { "1": rows[0], "2": rows[1] },
    selected: { "1": true, "2": true },
    boolFilters: { "1": { yes: true } },
    fromTable: "_Document100",
    schema: "dbo",
    periodFieldId: "2",
    periodMonths: 1,
    relationMode: "detail"
  });

  assert.match(sql, /FROM  \[dbo\]\.\[_Document100\] AS F/);
  assert.match(sql, /CAST\(F\.\[_Posted\] AS int\) AS \[Posted\]/);
  assert.match(sql, /WHERE CAST\(F\.\[_Posted\] AS int\) = 1 AND DATEADD\(YEAR, -2000, F\.\[_Date_Time\]\) >= DATEADD\(MONTH, -1, GETDATE\(\)\)/);
  assert.match(sql, /ORDER BY DATEADD\(YEAR, -2000, F\.\[_Date_Time\]\) DESC/);
});

test("generateSql detects VT table and joins document header in flat mode", () => {
  const rows = [
    { id: "1", object: "Doc", internal: "_Document100", parentId: null },
    { id: "2", object: "Number", title: "Number", internal: "_Number", type: "string", parentId: "1" },
    { id: "3", object: "Items", internal: "_Document100_VT200", parentId: "1" },
    { id: "4", object: "DocRef", internal: "_Document100_IDRRef", type: "uuid", parentId: "3" },
    { id: "5", object: "Qty", title: "Qty", internal: "_Fld300", type: "int", parentId: "3" }
  ];
  const { byId } = buildTree(rows);
  const result = generateSql({
    rows,
    byId,
    selected: { "2": true, "5": true },
    flatten: { "_document100_vt200": true },
    schema: "dbo",
    relationMode: "detail"
  });

  assert.match(result.sql, /FROM  \[dbo\]\.\[_Document100_VT200\] AS T/);
  assert.match(result.sql, /LEFT JOIN \[dbo\]\.\[_Document100\] AS H ON T\.\[_Document100_IDRRef\] = H\.\[_IDRRef\]/);
  assert.match(result.sql, /H\.\[_Number\] AS \[Number\]/);
  assert.match(result.sql, /CAST\(T\.\[_Fld300\] AS int\) AS \[Qty\]/);
  assert.ok(result.diagnostics.some(item => item.includes("JOIN header")));
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} tests passed`);
