import assert from "node:assert/strict";
import { buildQueryPlan } from "../src/core/queryPlan.js";
import { generateSql } from "../src/core/sqlGenerate.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function fixture(extra = {}) {
  const rows = [
    { id: "doc", object: "Doc", internal: "_Document100", parentId: null, metadata: "Document.Doc" },
    { id: "employee", object: "Employee", internal: "_Fld100RRef", parentId: "doc" },
    { id: "department", object: "Department", internal: "_Fld200RRef", parentId: "doc" },
    { id: "value", object: "Value", title: "Value", internal: "_Fld300", type: "int", parentId: "doc" },
    { id: "employees", object: "Employees", title: "Reference.Employees", type: "Reference.Employees", internal: "_Reference10", parentId: null },
    { id: "departments", object: "Departments", title: "Reference.Departments", type: "Reference.Departments", internal: "_Reference20", parentId: null },
    { id: "companies", object: "Companies", title: "Reference.Companies", type: "Reference.Companies", internal: "_Reference30", parentId: null }
  ];
  const meta = (id, baseTopId, chain, internal, path) => ({ id, baseTopId, chain, field: { object: internal, title: internal, internal, type: "string" }, displayPath: path });
  return {
    rows, byId: Object.fromEntries(rows.map(row => [row.id, row])), schema: "dbo",
    selected: { value: true }, metaById: {}, ...extra
  };
}
function synth(id, base, chain, field, path) { return { baseTopId: base, chain, field: { object: field, title: field, internal: field, type: "string" }, displayPath: path }; }
const employee = [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }];

test("physical selections are ready, deterministic, and immutable", () => {
  const input = fixture({ selected: { value: true, employee: true } }); const before = structuredClone(input);
  const first = buildQueryPlan(input), second = buildQueryPlan(input);
  assert.equal(first.status, "ready"); assert.equal(first.reason, null); assert.equal(first.joins.length, 0);
  assert.equal(first.selections.length, 2); assert.deepEqual(first, second); assert.deepEqual(input, before);
  assert.notEqual(first.selections, second.selections);
});
test("valid reference plan owns aliases, expression, and SQL join", () => {
  const input = fixture({ selected: { s: true }, metaById: { s: synth("forged", "employee", employee, "_Description", "Employee.Description") } });
  const plan = buildQueryPlan(input), result = generateSql(input), join = plan.joins[0];
  assert.equal(plan.status, "ready"); assert.equal(plan.selections[0].id, "s"); assert.equal(join.kind, "reference");
  assert.equal(join.sourceAlias, "T"); assert.equal(join.sourceColumn, "_Fld100RRef"); assert.equal(join.targetAlias, "R1"); assert.equal(join.targetColumn, "_IDRRef"); assert.equal(join.depth, 1); assert.deepEqual(join.syntheticIds, ["s"]);
  assert.equal(plan.selections[0].expression, "R1.[_Description]"); assert.ok(result.sql.includes("R1.[_Description] AS [Employee.Description]"));
});
test("shared physical reference join deduplicates synthetic IDs", () => {
  const input = fixture({ selected: { a: true, b: true }, metaById: { a: synth("a", "employee", employee, "_Code", "Employee.Code"), b: synth("b", "employee", employee, "_Description", "Employee.Description") } });
  const plan = buildQueryPlan(input), sql = generateSql(input).sql;
  assert.equal(plan.joins.filter(join => join.kind === "reference").length, 1); assert.deepEqual(plan.joins[0].syntheticIds, ["a", "b"]);
  assert.equal((sql.match(/LEFT JOIN/g) || []).length, 1); assert.match(sql, /R1\.\[_Code\]/); assert.match(sql, /R1\.\[_Description\]/);
});
test("depth two chain links aliases in canonical order", () => {
  const chain = [...employee, { refInternal: "_Fld110RRef", targetTable: "_Reference30", targetKind: "reference" }];
  const input = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", chain, "_Description", "Employee.Company.Description") } }); const plan = buildQueryPlan(input);
  assert.deepEqual(plan.joins.filter(join => join.kind === "reference").map(join => [join.sourceAlias, join.targetAlias, join.depth]), [["T", "R1", 1], ["R1", "R2", 2]]);
  assert.equal(plan.selections[0].expression, "R2.[_Description]"); assert.match(generateSql(input).sql, /R2\.\[_Description\]/);
});
test("blocked metadata scenarios never return partial SQL", () => {
  for (const [name, input, reason] of [
    ["missing", fixture({ selected: { s: true } }), "missing_metadata"],
    ["missing mixed", fixture({ selected: { value: true, s: true } }), "missing_metadata"],
    ["malformed", fixture({ selected: { s: true }, metaById: { s: { baseTopId: "employee", chain: employee } } }), "malformed_metadata"],
    ["malformed mixed", fixture({ selected: { value: true, s: true }, metaById: { s: { baseTopId: "employee", chain: employee } } }), "malformed_metadata"]
  ]) { const plan = buildQueryPlan(input); assert.equal(plan.status, "blocked", name); assert.equal(plan.reason, reason, name); assert.equal(generateSql(input).sql, "", name); assert.equal(plan.joins.filter(join => join.status === "sql").length, 0, name); }
});
test("invalid chains preserve canonical validation status and reason", () => {
  const cases = [
    [[], "unknown_type", "empty_chain"],
    [[{ refInternal: "_Fld100RRef", targetTable: "_Reference10" }], "unknown_type", "missing_target_kind"],
    [[{ refInternal: "_Fld100RRef", targetTable: "Bad", targetKind: "reference" }], "unknown_type", "invalid_target_table"],
    [[{ refInternal: "_Fld100RRef", targetTable: "_Reference999", targetKind: "reference" }], "not_found", "target_root_changed"],
    [[...employee, ...employee], "cycle", "repeated_target"]
  ];
  for (const [chain, status, reason] of cases) { const input = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", chain, "_Code", "X") } }); const plan = buildQueryPlan(input); assert.equal(plan.status, "blocked"); assert.equal(plan.reason, reason); assert.ok(plan.diagnostics.some(item => item.includes(status) && item.includes(reason))); assert.deepEqual(plan, buildQueryPlan(input)); }
});
test("missing and duplicate target roots block with target_root_changed", () => {
  const missing = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", employee, "_Code", "X") } }); missing.rows = missing.rows.filter(row => row.id !== "employees"); missing.byId = Object.fromEntries(missing.rows.map(row => [row.id, row]));
  const duplicate = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", employee, "_Code", "X") } }); duplicate.rows.push({ ...duplicate.byId.employees, id: "employees2" }); duplicate.byId.employees2 = duplicate.rows.at(-1);
  for (const input of [missing, duplicate]) { const plan = buildQueryPlan(input); assert.equal(plan.reason, "target_root_changed"); assert.equal(generateSql(input).sql, ""); }
});
test("refDepth normalization is shared by plan and SQL", () => {
  const six = Array.from({ length: 6 }, (_, index) => ({ refInternal: index ? `_Fld${index}00RRef` : "_Fld100RRef", targetTable: `_Reference${index + 1}0`, targetKind: "reference" }));
  for (const [depth, length, expected] of [[undefined, 5, "ready"], [0, 5, "ready"], [-1, 2, "blocked"], ["2", 2, "ready"], ["abc", 5, "ready"], [6, 5, "ready"], [6, 6, "blocked"]]) {
    const input = fixture({ refDepth: depth, selected: { s: true }, metaById: { s: synth("s", "employee", six.slice(0, length), "_Code", "X") } }); for (let i = 4; i <= 6; i += 1) input.rows.push({ id: `r${i}`, object: `R${i}`, internal: `_Reference${i}0`, parentId: null }); input.byId = Object.fromEntries(input.rows.map(row => [row.id, row])); assert.equal(buildQueryPlan(input).status, expected);
  }
});
test("header detail plan distinguishes explicit, structural, and blocked relations", () => {
  const rows = [{ id: "h", object: "H", internal: "_Document100", parentId: null, metadata: "D" }, { id: "hf", object: "N", internal: "_Number", parentId: "h" }, { id: "hk", object: "K", internal: "_IDRRef", parentId: "h" }, { id: "d", object: "D", internal: "_Document100_VT1", parentId: "h", metadata: "D" }, { id: "dk", object: "K", internal: "_Document100_IDRRef", parentId: "d" }, { id: "df", object: "Q", internal: "_Fld1", parentId: "d" }];
  const relation = confirmation => ({ matched: true, unambiguous: true, detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "_Document100_IDRRef", headerKeyColumn: "_IDRRef", candidates: [{ detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "_Document100_IDRRef", headerKeyColumn: "_IDRRef", confirmation }] });
  const input = { rows, byId: Object.fromEntries(rows.map(row => [row.id, row])), selected: { hf: true, df: true }, schema: "dbo", resolveTablePartHeaderJoin: () => relation("explicit_columns") }; const ready = buildQueryPlan(input); assert.equal(ready.joins[0].status, "sql"); assert.equal(ready.joins[0].confirmation, "explicit_columns"); assert.match(generateSql(input).sql, /LEFT JOIN \[dbo\]\.\[_Document100\] AS H/);
  for (const [confirmation, status, reason] of [["mxl_structural_owner", "structural", "physical_detail_foreign_key_not_confirmed"], ["other", "blocked", "physical_detail_foreign_key_not_confirmed"]]) { const plan = buildQueryPlan({ ...input, resolveTablePartHeaderJoin: () => relation(confirmation) }); assert.equal(plan.status, "blocked"); assert.equal(plan.joins[0].status, status); assert.equal(plan.joins[0].reason, reason); assert.equal(generateSql({ ...input, resolveTablePartHeaderJoin: () => relation(confirmation) }).sql, ""); }
});
let passed = 0; for (const item of tests) { item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); } console.log(`\n${passed} query plan tests passed`);
