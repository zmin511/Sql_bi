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
for (const [name, input, reason] of [
  ["missing metadata blocks synthetic-only selection", fixture({ selected: { s: true } }), "missing_metadata"],
  ["missing metadata blocks mixed selection", fixture({ selected: { value: true, s: true } }), "missing_metadata"],
  ["metadata without field blocks synthetic-only selection", fixture({ selected: { s: true }, metaById: { s: { baseTopId: "employee", chain: employee } } }), "malformed_metadata"],
  ["metadata without field blocks mixed selection", fixture({ selected: { value: true, s: true }, metaById: { s: { baseTopId: "employee", chain: employee } } }), "malformed_metadata"]
]) test(name, () => { const plan = buildQueryPlan(input), sql = generateSql(input); assert.equal(plan.status, "blocked"); assert.equal(plan.reason, reason); assert.equal(sql.sql, ""); assert.equal(plan.joins.length, 0); assert.match(plan.diagnostics.join("\n"), new RegExp(reason)); assert.deepEqual(plan, buildQueryPlan(input)); });

for (const [name, chain, reason] of [
  ["empty reference chain fails closed", [], "empty_chain"],
  ["missing target kind fails closed", [{ refInternal: "_Fld100RRef", targetTable: "_Reference10" }], "missing_target_kind"],
  ["invalid target table fails closed", [{ refInternal: "_Fld100RRef", targetTable: "Bad", targetKind: "reference" }], "invalid_target_table"],
  ["missing target root fails closed", [{ refInternal: "_Fld100RRef", targetTable: "_Reference999", targetKind: "reference" }], "target_root_changed"],
  ["repeated target fails closed", [...employee, ...employee], "repeated_target"]
]) test(name, () => { const input = fixture({ selected: { s: true }, metaById: { s: synth("forged", "employee", chain, "_Code", "X") } }); const plan = buildQueryPlan(input), sql = generateSql(input); assert.equal(plan.status, "blocked"); assert.equal(plan.reason, reason); assert.equal(sql.sql, ""); assert.equal(sql.sql.includes("LEFT JOIN"), false); assert.equal(sql.sql.includes("SELECT"), false); assert.match(plan.diagnostics.join("\n"), new RegExp(reason)); });

for (const [name, depth, length, status] of [
  ["undefined refDepth normalizes to five", undefined, 5, "ready"],
  ["zero refDepth normalizes to five", 0, 5, "ready"],
  ["negative refDepth normalizes to one", -1, 2, "blocked"],
  ["numeric string refDepth normalizes", "2", 2, "ready"],
  ["invalid string refDepth normalizes to five", "abc", 5, "ready"],
  ["oversized refDepth normalizes to five", 6, 5, "ready"],
  ["six-step chain is blocked after normalization", 6, 6, "blocked"]
]) test(name, () => { const chain = Array.from({ length }, (_, index) => ({ refInternal: index ? `_Fld${index}00RRef` : "_Fld100RRef", targetTable: `_Reference${index + 1}0`, targetKind: "reference" })); const input = fixture({ refDepth: depth, selected: { s: true }, metaById: { s: synth("s", "employee", chain, "_Code", "X") } }); for (let index = 4; index <= 6; index += 1) input.rows.push({ id: `r${index}`, object: `R${index}`, internal: `_Reference${index}0`, parentId: null }); input.byId = Object.fromEntries(input.rows.map(row => [row.id, row])); const plan = buildQueryPlan(input), sql = generateSql(input); assert.equal(plan.status, status); assert.equal(sql.plan.status, status); assert.equal(status === "blocked" ? sql.sql : plan.selections.length > 0, status === "blocked" ? "" : true); });

test("reference edge records physical source identity", () => { const input = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", employee, "_Code", "X") } }); const edge = buildQueryPlan(input).joins[0]; assert.equal(edge.sourceRowId, "employee"); assert.equal(edge.sourceTable, "_Document100"); assert.equal(edge.targetRootId, "employees"); assert.equal(edge.id, "reference:T:_Fld100RRef:_Reference10:_IDRRef:1"); });
test("nested reference edge records preceding target table", () => { const chain = [...employee, { refInternal: "_Fld110RRef", targetTable: "_Reference30", targetKind: "reference" }]; const edges = buildQueryPlan(fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", chain, "_Code", "X") } })).joins; assert.equal(edges[1].sourceRowId, null); assert.equal(edges[1].sourceTable, "_Reference10"); assert.equal(edges[1].targetRootId, "companies"); });
test("renderer consumes pre-rendered plan join SQL", () => { const input = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", employee, "_Code", "X") } }); const plan = buildQueryPlan(input), result = generateSql(input); assert.equal(result.plan.joins[0].sql, plan.joins[0].sql); assert.ok(result.sql.includes(plan.joins[0].sql)); assert.equal(result.sql.match(/LEFT JOIN/g).length, 1); });
test("reference join synthetic IDs are deduplicated and ordered", () => { const input = fixture({ selected: { b: true, a: true }, metaById: { a: synth("a", "employee", employee, "_Code", "A"), b: synth("b", "employee", employee, "_Description", "B") } }); const edge = buildQueryPlan(input).joins[0]; assert.deepEqual(edge.syntheticIds, ["a", "b"]); assert.equal(new Set(edge.syntheticIds).size, 2); });
test("each ready selection exposes the public contract", () => { const plan = buildQueryPlan(fixture({ selected: { value: true } })); const selection = plan.selections[0]; for (const key of ["id", "kind", "sourceRowId", "sourceTable", "sourceAlias", "field", "outputAlias", "expression", "chain"]) assert.ok(Object.hasOwn(selection, key), key); assert.equal(selection.id, "value"); assert.equal(selection.sourceRowId, "value"); assert.equal(selection.sourceAlias, "T"); });
test("synthetic selection uses selected ID instead of meta ID", () => { const input = fixture({ selected: { selectedId: true }, metaById: { selectedId: synth("forged", "employee", employee, "_Code", "X") } }); const selection = buildQueryPlan(input).selections[0]; assert.equal(selection.id, "selectedId"); assert.notEqual(selection.id, "forged"); assert.equal(selection.sourceRowId, "employee"); });
test("repeated plans do not share mutable join arrays", () => { const input = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", employee, "_Code", "X") } }); const first = buildQueryPlan(input), second = buildQueryPlan(input); first.joins[0].syntheticIds.push("mutated"); first.diagnostics.push("mutated"); assert.deepEqual(second.joins[0].syntheticIds, ["s"]); assert.equal(second.diagnostics.includes("mutated"), false); });
test("empty selection retains backward compatible SQL", () => { const result = generateSql(fixture({ selected: {} })); assert.equal(result.plan.status, "ready"); assert.equal(result.sql, "-- Select at least one field"); assert.deepEqual(result.diagnostics, []); });
test("header SQL join is pre-rendered in the plan", () => { const rows = [{ id: "h", object: "H", internal: "_Document100", parentId: null }, { id: "hf", object: "N", internal: "_Number", parentId: "h" }, { id: "d", object: "D", internal: "_Document100_VT1", parentId: "h" }, { id: "df", object: "Q", internal: "_Fld1", parentId: "d" }]; const relation = { matched: true, unambiguous: true, detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "_Document100_IDRRef", headerKeyColumn: "_IDRRef", candidates: [{ detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "_Document100_IDRRef", headerKeyColumn: "_IDRRef", confirmation: "explicit_columns" }] }; const input = { rows, byId: Object.fromEntries(rows.map(row => [row.id, row])), selected: { hf: true, df: true }, schema: "dbo", resolveTablePartHeaderJoin: () => relation }; const result = generateSql(input); assert.equal(result.plan.joins[0].status, "sql"); assert.ok(result.sql.includes(result.plan.joins[0].sql)); assert.equal(result.plan.joins[0].sql.includes(" AS H ON "), true); });
test("physical selection renders its plan expression unchanged", () => { const result = generateSql(fixture({ selected: { value: true } })); assert.equal(result.plan.selections[0].expression, "CAST(T.[_Fld300] AS int)"); assert.ok(result.sql.includes("CAST(T.[_Fld300] AS int) AS [Value]")); assert.equal(result.plan.sqlParts.from, "[dbo].[_Document100]"); });
test("boolean filter is stored in canonical WHERE plan", () => { const input = fixture({ selected: { value: true }, boolFilters: { value: { yes: true, no: false } } }); input.byId.value.type = "bool"; const result = generateSql(input); assert.deepEqual(result.plan.sqlParts.wheres, ["CAST(T.[_Fld300] AS int) = 1"]); assert.ok(result.sql.includes("WHERE CAST(T.[_Fld300] AS int) = 1")); });
test("manual FROM plan uses the F alias", () => { const result = generateSql(fixture({ fromTable: "_Manual", selected: { value: true } })); assert.equal(result.plan.status, "ready"); assert.equal(result.plan.sqlParts.baseAlias, "F"); assert.equal(result.plan.selections[0].sourceAlias, "F"); assert.ok(result.sql.includes("FROM  [dbo].[_Manual] AS F")); });
test("selection ordering is deterministic across insertion order", () => { const left = fixture({ selected: { employee: true, value: true } }); const right = fixture({ selected: { value: true, employee: true } }); assert.deepEqual(buildQueryPlan(left).selections.map(item => item.id), buildQueryPlan(right).selections.map(item => item.id)); assert.equal(generateSql(left).sql, generateSql(right).sql); });
test("synthetic input metadata and chain remain immutable", () => { const input = fixture({ selected: { s: true }, metaById: { s: synth("forged", "employee", employee, "_Code", "X") } }); const before = structuredClone(input); buildQueryPlan(input); generateSql(input); assert.deepEqual(input, before); });
test("join IDs do not depend on previous calls", () => { const input = fixture({ selected: { s: true }, metaById: { s: synth("s", "employee", employee, "_Code", "X") } }); const before = buildQueryPlan(input).joins.map(join => join.id); buildQueryPlan(fixture({ selected: { s: true }, metaById: { s: synth("s", "department", [{ refInternal: "_Fld200RRef", targetTable: "_Reference20", targetKind: "reference" }], "_Code", "Y") } })); assert.deepEqual(buildQueryPlan(input).joins.map(join => join.id), before); });
let passed = 0; for (const item of tests) { item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); } console.log(`\n${passed} query plan tests passed`);
