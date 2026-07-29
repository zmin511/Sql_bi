import assert from "node:assert/strict";
import { castExpr } from "../src/core/casts.js";
import { sqlDateExpr } from "../src/core/dates.js";
import { generateSql } from "../src/core/sqlGenerate.js";
import { makeUniqueColumnAlias } from "../src/core/sqlIdentifiers.js";

const row = (id, internal, title) => ({ id, internal, object: title, title, parentId: null });
const field = (id, internal, title, type = "") => ({ ...row(id, internal, title), type });

function input(rows, selected, extra = {}) {
  return { rows, byId: Object.fromEntries(rows.map(item => [item.id, item])), selected, schema: "dbo", ...extra };
}
function manual(rows, selected, fromTable, extra = {}) {
  return generateSql(input(rows, selected, { fromTable, ...extra }));
}

assert.equal(castExpr("T", "A]B", ""), "T.[A]]B]");
assert.equal(castExpr("T", "   ", ""), null);
assert.equal(sqlDateExpr("T", "A]B", "date"), "DATEADD(YEAR, -2000, T.[A]]B])");
assert.equal(sqlDateExpr("T", "   ", "date"), null);

{
  const rows = [row("one", "Поле]1", "Одинаково"), row("two", "Поле 2", "одинаково")];
  const result = generateSql(input(rows, { two: true, one: true }, { fromTable: "schema.table" }));
  assert.match(result.sql, /FROM  \[dbo\]\.\[schema\.table\] AS F/);
  assert.match(result.sql, /F\.\[Поле]]1\] AS \[Одинаково\]/);
  assert.match(result.sql, /F\.\[Поле 2\] AS \[одинаково \(2\)\]/);
}

{
  const rows = [row("bad", "   ", "Bad"), row("good", "_Fld1", "Good")];
  const result = generateSql(input(rows, { bad: true, good: true }, { fromTable: "Таблица]" }));
  assert.match(result.sql, /FROM  \[dbo\]\.\[Таблица]]\] AS F/);
  assert.match(result.sql, /F\.\[_Fld1\] AS \[Good\]/);
  assert.doesNotMatch(result.sql, /AS \[Bad\]/);
  assert.ok(result.diagnostics.some(message => message.includes("безопасное SQL-имя")));
}

console.log("SQL identifier integration tests passed");

function assertFrom(table, expected) {
  const result = manual([field("f", "_Fld1", "Value")], { f: true }, table);
  assert.ok(result.sql.includes(`FROM  ${expected} AS F`), result.sql);
}

for (const [table, expected] of [
  ["Manual", "[dbo].[Manual]"], ["Таблица", "[dbo].[Таблица]"],
  ["Table Name", "[dbo].[Table Name]"], ["A]B", "[dbo].[A]]B]"],
  ["schema.table", "[dbo].[schema.table]"], ["Table; DROP TABLE X", "[dbo].[Table; DROP TABLE X]"]
]) assertFrom(table, expected);

{
  const rows = [field("b", "Флаг]", "Bool", "boolean"), field("d", "Дата Поле", "Date", "date"), field("n", "Число]", "Amount", "decimal(10,2)")];
  const result = manual(rows, { b: true, d: true, n: true }, "Manual", { boolFilters: { b: { yes: true } }, periodFieldId: "d", periodMonths: 1 });
  assert.ok(result.sql.includes("CAST(F.[Флаг]] ]".replace("]] ", "]]")));
  assert.ok(result.sql.includes("WHERE CAST(F.[Флаг]]] AS int) = 1"));
  assert.ok(result.sql.includes("DATEADD(YEAR, -2000, F.[Дата Поле])"));
  assert.ok(result.sql.includes("CAST(F.[Число]] ]".replace("]] ", "]]")));
}

{
  const long = "L".repeat(129);
  const rows = [field("a", "_A", "Name"), field("b", "_B", "Name"), field("c", "_C", "name"), field("d", "_D", "A]B"), field("e", "_E", long), field("f", "_F", long)];
  const first = manual(rows, { f: true, e: true, d: true, c: true, b: true, a: true }, "Manual");
  const second = manual(rows, { f: true, e: true, d: true, c: true, b: true, a: true }, "Manual");
  const expectedAliases = new Set();
  const longFirst = makeUniqueColumnAlias(long, expectedAliases);
  const longSecond = makeUniqueColumnAlias(long, expectedAliases);
  assert.equal(first.sql, second.sql); assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.ok(first.sql.includes("AS [Name]")); assert.ok(first.sql.includes("AS [Name (2)]")); assert.ok(first.sql.includes("AS [name (3)]")); assert.ok(first.sql.includes("AS [A]]B]"));
  assert.notEqual(longFirst, longSecond);
  assert.ok(longFirst.includes("~") && longSecond.includes("~"));
  assert.ok(longFirst.slice(1, -1).length <= 128 && longSecond.slice(1, -1).length <= 128);
  assert.ok(first.sql.includes(`AS ${longFirst}`) && first.sql.includes(`AS ${longSecond}`));
}

{
  const result = manual([field("bad", "   ", "Bad")], { bad: true }, "Manual");
  assert.equal(result.sql, ""); assert.ok(result.diagnostics.some(item => item.includes("нет выбранных колонок")));
}

console.log("extended SQL identifier integration coverage passed");

{
  for (const table of ["_Document100", "_Reference45", "_AccumRg12", "_InfoRg20", "_Catalog30", "_Document100_VT1"]) {
    const root = { id: `root-${table}`, internal: table, object: "Root", parentId: null };
    const value = { ...field(`value-${table}`, "_Fld1", "Value"), parentId: root.id };
    const result = generateSql(input([root, value], { [value.id]: true }, { dbName: "UMC" }));
    assert.ok(result.sql.includes(`FROM  [UMC].[dbo].[${table}] AS T`), result.sql);
  }
  const unknownRoot = { id: "unknown-root", internal: "Table Name", object: "Root", parentId: null };
  const unknownField = { ...field("unknown-field", "_Fld1", "Value"), parentId: "unknown-root" };
  const unknown = generateSql(input([unknownRoot, unknownField], { "unknown-field": true }));
  assert.equal(unknown.sql, "");
  assert.ok(unknown.diagnostics.some(item => item.includes("физическое происхождение")));
}

{
  const header = { id: "h", internal: "_Document100", object: "Header", parentId: null };
  const detail = { id: "d", internal: "_Document100_VT1", object: "Detail", parentId: "h" };
  const hf = { ...field("hf", "Ключ]", "Alias"), parentId: "h" };
  const df = { ...field("df", "Связь]", "Alias"), parentId: "d" };
  const relation = { matched: true, unambiguous: true, detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "Связь]", headerKeyColumn: "Ключ]", candidates: [{ detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "Связь]", headerKeyColumn: "Ключ]", confirmation: "explicit_columns" }] };
  const result = generateSql(input([header, detail, hf, df], { hf: true, df: true }, { resolveTablePartHeaderJoin: () => relation }));
  assert.ok(result.sql.includes("LEFT JOIN [dbo].[_Document100] AS H ON T.[Связь]]] = H.[Ключ]]]"));
  assert.ok(result.sql.includes("AS [Alias]") && result.sql.includes("AS [Alias (2)]"));
  const invalid = generateSql(input([header, detail, hf, df], { hf: true, df: true }, { resolveTablePartHeaderJoin: () => ({ ...relation, detailForeignKeyColumn: " ", candidates: [{ ...relation.candidates[0], detailForeignKeyColumn: " " }] }) }));
  assert.equal(invalid.sql, ""); assert.ok(invalid.diagnostics.some(item => item.includes("JOIN шапки")));
}

{
  const base = { id: "base", internal: "_Document100", object: "Base", parentId: null };
  const original = { ...field("o", "Обычное]", "Same"), parentId: "base" };
  const targetRoot = { id: "target-root", internal: "_Reference45", object: "Target", parentId: null };
  const synthetic = {
    id: "s",
    field: { internal: "Цель]", object: "Same", title: "Same" },
    displayPath: "Same",
    baseTopId: "base",
    chain: [{
      refInternal: "Источник]",
      targetTable: "_Reference45",
      targetKind: "reference"
    }]
  };
  const options = { fromTable: "Manual", dbName: "UMC", metaById: { s: synthetic } };
  const fixtureRows = [base, original, targetRoot];
  const result = generateSql(input(fixtureRows, { s: true, o: true }, options));
  const repeat = generateSql(input(fixtureRows, { s: true, o: true }, options));
  assert.equal(result.sql, repeat.sql); assert.deepEqual(result.diagnostics, repeat.diagnostics);
  assert.ok(result.sql.includes("LEFT JOIN [UMC].[dbo].[_Reference45] AS R1 ON R1.[_IDRRef] = F.[Источник]]]"));
  assert.ok(result.sql.includes("F.[Обычное]]] AS [Same]"));
  assert.ok(result.sql.includes("R1.[Цель]]] AS [Same (2)]"));
  const broken = generateSql(input([base, targetRoot], { s: true }, {
    fromTable: "Manual",
    dbName: "UMC",
    metaById: {
      s: {
        ...synthetic,
        chain: [{
          refInternal: "Источник]",
          targetTable: " ",
          targetKind: "reference"
        }]
      }
    }
  }));
  assert.equal(broken.sql, "");
  assert.ok(broken.diagnostics.some(item => item.includes("invalid_target_table")));
}

{
  const rows = [field("value", "_Fld1", "Value"), field("bool", "   ", "Bool", "boolean")];
  const result = manual(rows, { value: true, bool: true }, "Manual");
  assert.ok(result.sql.includes("F.[_Fld1] AS [Value]"));
  assert.doesNotMatch(result.sql, /WHERE|AS \[Bool\]|undefined|null|\[\s*\]/);
  assert.ok(result.diagnostics.some(item => item === "Поле пропущено: отсутствует безопасное SQL-имя колонки."));
}

{
  const rows = [field("value", "_Fld1", "Value"), field("date", "   ", "Date", "date")];
  const result = manual(rows, { value: true, date: true }, "Manual", { periodFieldId: "date", periodMonths: 1 });
  assert.ok(result.sql.includes("F.[_Fld1] AS [Value]"));
  assert.doesNotMatch(result.sql, /WHERE|ORDER BY|undefined|null|\[\s*\]/);
  assert.ok(result.diagnostics.some(item => item.includes("поля даты")));
}

{
  const rows = [field("a", "_A", "Alias"), field("b", "_B", "Alias"), field("c", "_C", "Alias"), field("x", "_X", "X".repeat(127)), field("y", "_Y", "Y".repeat(128))];
  const result = manual(rows, { a: true, b: true, c: true, x: true, y: true }, "Manual");
  assert.ok(result.sql.includes("AS [Alias]") && result.sql.includes("AS [Alias (2)]") && result.sql.includes("AS [Alias (3)]"));
  assert.ok(result.sql.includes(`AS [${"X".repeat(127)}]`) && result.sql.includes(`AS [${"Y".repeat(128)}]`));
}
