import assert from "node:assert/strict";
import { buildQueryPlan } from "../src/core/queryPlan.js";
import { generateSql } from "../src/core/sqlGenerate.js";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function fixture(extra = {}) {
  const rows = [
    { id: "doc", object: "Документ", internal: "_Document100", parentId: null },
    { id: "value", object: "Сумма заказа", title: "Сумма заказа", internal: "_Fld300", type: "numeric(15,2)", parentId: "doc" },
    { id: "date", object: "Дата", title: "Дата", internal: "_Date_Time", type: "datetime", parentId: "doc" },
    { id: "owner", object: "Владелец", internal: "_Fld400RRef", type: "Reference.Owners", parentId: "doc" },
    { id: "owners", object: "Владельцы", internal: "_Reference20", parentId: null }
  ];
  return {
    rows,
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    schema: "dbo",
    selected: { value: true },
    metaById: {},
    ...extra
  };
}

function syntheticMeta() {
  return {
    baseTopId: "owner",
    chain: [{ refInternal: "_Fld400RRef", targetTable: "_Reference20", targetKind: "reference" }],
    field: { object: "Наименование", title: "Наименование", internal: "_Description", type: "string" },
    displayPath: "Владелец.Наименование"
  };
}

test("physical projection exposes the canonical inspection contract", () => {
  const projection = buildQueryPlan(fixture()).selections[0];
  assert.deepEqual(
    {
      selectionId: projection.selectionId,
      sourceTable: projection.sourceTable,
      sourceField: projection.sourceField,
      expression: projection.expression,
      outputAlias: projection.outputAlias,
      status: projection.status
    },
    {
      selectionId: "value",
      sourceTable: "_Document100",
      sourceField: "_Fld300",
      expression: "CAST(T.[_Fld300] AS decimal(15,2))",
      outputAlias: "[Сумма заказа]",
      status: "active"
    }
  );
});

test("transformed projection exposes the exact date expression", () => {
  const plan = buildQueryPlan(fixture({ selected: { date: true } }));
  assert.match(plan.selections[0].expression, /^DATEADD\(YEAR, -2000, /);
  assert.equal(plan.selections[0].sourceField, "_Date_Time");
});

test("Unicode final alias is the alias used by generated SQL", () => {
  const result = generateSql(fixture());
  const projection = result.plan.selections[0];
  assert.equal(projection.outputAlias, "[Сумма заказа]");
  assert.ok(result.sql.includes(`${projection.expression} AS ${projection.outputAlias}`));
});

test("synthetic projection identifies its resolved physical source", () => {
  const input = fixture({ selected: { synthetic: true }, metaById: { synthetic: syntheticMeta() } });
  const projection = buildQueryPlan(input).selections[0];
  assert.equal(projection.kind, "synth");
  assert.equal(projection.sourceTable, "_Reference20");
  assert.equal(projection.sourceField, "_Description");
  assert.equal(projection.expression, "R1.[_Description]");
  assert.equal(projection.outputAlias, "[Владелец.Наименование]");
});

test("projection contract is deterministic across repeated builds", () => {
  const input = fixture({ selected: { date: true, value: true } });
  assert.deepEqual(buildQueryPlan(input).selections, buildQueryPlan(input).selections);
});

test("blocked synthetic projection preserves canonical reason without partial SQL", () => {
  const result = generateSql(fixture({ selected: { missing: true } }));
  assert.equal(result.sql, "");
  assert.equal(result.plan.status, "blocked");
  assert.deepEqual(result.plan.selections.map(item => ({
    selectionId: item.selectionId,
    status: item.status,
    reason: item.reason,
    expression: item.expression
  })), [{ selectionId: "missing", status: "blocked", reason: "missing_metadata", expression: null }]);
});

test("production HTML contains the semantic Projected fields table", () => {
  const { html } = loadProductionRuntime();
  assert.match(html, /<h3[^>]*>Projected fields<\/h3>/);
  for (const heading of ["Alias", "Source", "Expression", "Status"]) assert.match(html, new RegExp(`<th[^>]*>${heading}</th>`));
});

test("production UI renders canonical projection values without truncation", () => {
  const value = loadProductionRuntime();
  value.api.importRows(fixture().rows);
  value.api.state.selected = { value: true };
  value.api.renderSQL();
  const projection = value.api.state.queryPlan.selections[0];
  const rendered = value.elements.get("queryPlanProjectedFields").children[0].children.map(cell => cell.textContent);
  assert.deepEqual(rendered, [
    projection.outputAlias,
    `${projection.sourceTable}.${projection.sourceField}`,
    projection.expression,
    projection.status
  ]);
  assert.equal(rendered[2], "CAST(T.[_Fld300] AS decimal(15,2))");
});

test("production UI row count matches canonical projections", () => {
  const value = loadProductionRuntime();
  value.api.importRows(fixture().rows);
  value.api.state.selected = { value: true, date: true };
  value.api.renderSQL();
  assert.equal(value.elements.get("queryPlanProjectedFields").children.length, value.api.state.queryPlan.selections.length);
});

test("production UI has an explanatory empty state", () => {
  const value = loadProductionRuntime();
  value.api.state.selected = {};
  value.api.renderSQL();
  assert.equal(value.elements.get("queryPlanProjectedFields").children.length, 0);
  assert.match(value.elements.get("queryPlanProjectedFieldsEmpty").textContent, /Нет выбранных полей для SELECT/);
});

test("production UI renders the canonical blocked reason", () => {
  const value = loadProductionRuntime();
  value.api.state.selected = { missing: true };
  value.api.renderSQL();
  const rendered = value.elements.get("queryPlanProjectedFields").children[0].children.map(cell => cell.textContent);
  assert.deepEqual(rendered.slice(-1), ["blocked: missing_metadata"]);
});

test("production renderer does not resolve aliases or rebuild SQL expressions", () => {
  const source = String(loadProductionRuntime().api.renderQueryPlanPanel);
  for (const forbidden of ["makeUniqueColumnAlias", "outputAliasBase", "castExpr", "sqlDateExpr", "resolveReferenceTarget"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("project snapshots do not serialize derived inspection state", () => {
  const value = loadProductionRuntime();
  value.api.importRows(fixture().rows);
  value.api.state.selected = { value: true };
  value.api.renderSQL();
  const snapshot = value.api.createProjectSnapshot();
  for (const key of ["queryPlan", "queryResult", "projectedFields", "inspection"]) assert.equal(key in snapshot, false, key);
});

test("raw production HTML does not expose a mutable test API", () => {
  const { html, runtime } = loadProductionRuntime({ instrument: false });
  assert.equal(html.includes("window.__SQLBI_TEST__"), false);
  assert.equal(runtime.__SQLBI_TEST__, undefined);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  console.log(`ok ${++passed} - ${item.name}`);
}
console.log(`\n${passed} projected fields inspection tests passed`);
