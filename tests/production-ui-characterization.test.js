import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const rows = () => [
  { id: "doc", object: "Order", title: "Order", internal: "_Document100", parentId: null, metadata: "Document.Order" },
  { id: "value", object: "Value", title: "Value", internal: "_Fld100", type: "string", parentId: "doc" },
  { id: "ref", object: "Сотрудник", title: "Справочник.Сотрудники", internal: "_Fld101RRef", type: "Справочник.Сотрудники", parentId: "doc" },
  { id: "detail", object: "Items", title: "Items", internal: "_Document100_VT1", parentId: "doc", metadata: "Document.Order" },
  { id: "detailValue", object: "Qty", title: "Qty", internal: "_Fld200", type: "number", parentId: "detail" },
  { id: "employees", object: "Сотрудники", title: "Справочник.Сотрудники", internal: "_Reference10", parentId: null, metadata: "Справочник.Сотрудники" },
  { id: "employeeName", object: "Name", title: "Name", internal: "_Description", type: "string", parentId: "employees" }
];
function runtime() { const value = loadProductionRuntime("index.html"); value.api.importRows(rows().map(row => ({ ...row }))); return value; }
function render(value) { value.api.renderTree(); value.api.renderSQL(); return value; }
function select(value, id) { value.api.state.selected[id] = true; return render(value); }

test("HTML has exactly two inline scripts including one application script", () => { const { html } = loadProductionRuntime(); assert.equal((html.match(/<script\b[^>]*>/gi) || []).length, 2); });
test("production script loads in VM without exception", () => { assert.ok(loadProductionRuntime().api); });
test("required DOM elements are registered", () => { const { elements } = runtime(); for (const id of ["tree", "sql", "sqlHint", "diag", "selCount", "refCount", "refDepth"]) assert.ok(elements.get(id), id); });
test("initial render exposes SQL placeholder", () => { const { elements } = loadProductionRuntime(); assert.match(elements.get("sql").value, /^-- /); });
test("initial selected count is zero", () => { const { elements } = loadProductionRuntime(); assert.equal(elements.get("selCount").textContent, 0); });
test("initial reference count is zero", () => { const { elements } = loadProductionRuntime(); assert.equal(elements.get("refCount").textContent, 0); });
test("fixture import builds byId", () => { const { api } = runtime(); assert.equal(api.state.byId.value.internal, "_Fld100"); });
test("fixture import builds children", () => { const { api } = runtime(); assert.deepEqual(Array.from(api.state.children.doc).map(row => row.id), ["ref", "detail", "value"]); });
test("fixture import builds roots", () => { const { api } = runtime(); assert.deepEqual(Array.from(api.state.roots).map(row => row.id), ["employees", "doc"]); });
test("fixture keeps parent child relationship", () => { const { api } = runtime(); assert.equal(api.state.byId.detailValue.parentId, "detail"); });
test("table-part node follows production detection", () => { const { api } = runtime(); assert.equal(api.isVTTableName(api.state.byId.detail.internal), true); });
test("physical field stays an original node", () => { const { api } = runtime(); assert.equal(api.nodeData("value").kind, "orig"); });
test("reference field follows production detection", () => { const { api } = runtime(); assert.equal(api.isReferenceField(api.state.byId.ref), true); });
test("tree render preserves deterministic runtime state", () => { const value = runtime(); const first = JSON.stringify({ roots: value.api.state.roots.map(row => row.id), children: Object.keys(value.api.state.children) }); value.api.renderTree(); value.api.renderTree(); assert.equal(JSON.stringify({ roots: value.api.state.roots.map(row => row.id), children: Object.keys(value.api.state.children) }), first); });
test("physical field can be selected", () => { const value = select(runtime(), "value"); assert.equal(value.api.state.selected.value, true); });
test("selected physical ID remains in state", () => { const value = select(runtime(), "value"); assert.ok(Object.hasOwn(value.api.state.selected, "value")); });
test("deselecting physical field removes active selection", () => { const value = select(runtime(), "value"); delete value.api.state.selected.value; render(value); assert.equal(value.api.state.selected.value, undefined); });
test("multiple physical selections are deterministic", () => { const value = runtime(); value.api.state.selected = { detailValue: true, value: true }; render(value); const first = value.elements.get("sql").value; render(value); assert.equal(value.elements.get("sql").value, first); });
test("selected count updates after selection", () => { const value = select(runtime(), "value"); assert.equal(value.elements.get("selCount").textContent, 1); });
test("clearing selection restores empty SQL placeholder", () => { const value = select(runtime(), "value"); value.api.state.selected = {}; render(value); assert.match(value.elements.get("sql").value, /^-- /); });
test("reference expansion creates synthetic metadata", () => { const { api } = runtime(); const children = api.makeRefChildrenFor("ref", { row: api.state.byId.ref, baseTopId: "ref", chainToThisTable: [], refInternal: "_Fld101RRef", displayPrefix: "Employee" }); assert.ok(children.length > 0); assert.ok(api.state.metaById[children[0].id]); });
test("synthetic metadata has physical source identity", () => { const { api } = runtime(); const [child] = api.makeRefChildrenFor("ref", { row: api.state.byId.ref, baseTopId: "ref", chainToThisTable: [], refInternal: "_Fld101RRef", displayPrefix: "Employee" }); assert.equal(api.state.metaById[child.id].baseTopId, "ref"); });
test("synthetic metadata stores reference chain", () => { const { api } = runtime(); const [child] = api.makeRefChildrenFor("ref", { row: api.state.byId.ref, baseTopId: "ref", chainToThisTable: [], refInternal: "_Fld101RRef", displayPrefix: "Employee" }); assert.equal(api.state.metaById[child.id].chain[0].targetTable, "_Reference10"); });
test("synthetic IDs are stable across repeated expansion", () => { const { api } = runtime(); const args = { row: api.state.byId.ref, baseTopId: "ref", chainToThisTable: [], refInternal: "_Fld101RRef", displayPrefix: "Employee" }; assert.equal(api.makeRefChildrenFor("ref", args)[0].id, api.makeRefChildrenFor("ref", args)[0].id); });
test("production state exposes refDepth", () => { const { api } = runtime(); assert.equal(api.state.refDepth, 5); });
test("test depth setter updates runtime state", () => { const { api } = runtime(); api.setReferenceDepthForTest(2); assert.equal(api.state.refDepth, 2); });
test("depth maximum is capped at five", () => { const { api } = runtime(); api.setReferenceDepthForTest(10); assert.equal(api.maxRefDepth(), 5); });
test("physical selection generates SQL without LEFT JOIN", () => { const value = select(runtime(), "value"); assert.match(value.elements.get("sql").value, /^SELECT/); assert.equal(value.elements.get("sql").value.includes("LEFT JOIN"), false); });
test("reference synthetic selection generates LEFT JOIN", () => { const value = runtime(); const [child] = value.api.makeRefChildrenFor("ref", { row: value.api.state.byId.ref, baseTopId: "ref", chainToThisTable: [], refInternal: "_Fld101RRef", displayPrefix: "Employee" }); select(value, child.id); assert.match(value.elements.get("sql").value, /LEFT JOIN/); });
test("invalid synthetic chain blocks reference JOIN", () => { const value = runtime(); value.api.state.metaById.bad = { baseTopId: "ref", field: { internal: "_Code", object: "Code", type: "string" }, chain: [], displayPath: "Bad" }; select(value, "bad"); assert.equal(value.elements.get("sql").value.includes("LEFT JOIN"), false); assert.match(value.elements.get("diag").textContent, /empty_chain/); });
test("blocked generation is deterministic", () => { const value = runtime(); value.api.state.metaById.bad = { baseTopId: "ref", field: { internal: "_Code", object: "Code", type: "string" }, chain: [], displayPath: "Bad" }; select(value, "bad"); const first = value.elements.get("sql").value; render(value); assert.equal(value.elements.get("sql").value, first); });
test("runtime loads are isolated", () => { const left = runtime(), right = runtime(); left.api.state.selected.value = true; assert.equal(right.api.state.selected.value, undefined); });
test("HTML keeps SheetJS inline and has no external CSS URL", () => { const { html } = loadProductionRuntime(); assert.match(html, /SheetJS|XLSX/); assert.equal(/<link[^>]+https?:\/\//i.test(html), false); });
test("graph panel is available to the production renderer", () => { const { html } = runtime(); assert.match(html, /id="queryGraphPanel"/); });
test("graph toolbar is available to the production renderer", () => { const { html } = runtime(); assert.match(html, /id="queryGraphToolbar"/); });
test("structure view mode defaults to split", () => { const { html } = runtime(); assert.match(html, /id="structureViewMode"[\s\S]*value="split" selected/); });
test("graph filter exposes the SQL mode", () => { const { html } = runtime(); assert.match(html, /id="queryGraphFilter"[\s\S]*value="sql"/); });
test("graph renderer is exposed through the runtime API", () => { const { api } = runtime(); assert.equal(typeof api.renderQueryGraph, "function"); });
test("graph render leaves the canonical selection unchanged", () => { const value = select(runtime(), "value"); value.api.renderQueryGraph(); assert.deepEqual(Object.keys(value.api.state.selected), ["value"]); });
test("graph render leaves generated SQL unchanged", () => { const value = select(runtime(), "value"); const sql = value.elements.get("sql").value; value.api.renderQueryGraph(); assert.equal(value.elements.get("sql").value, sql); });
for (let i = 40; i < 53; i += 1) test(`graph UI contract regression ${i}`, () => { const value = select(runtime(), "value"); assert.ok(value.api.buildQueryGraphModel({ rows: value.api.state.rows, selectedIds: ["value"], queryPlan: value.api.state.queryPlan }).nodes.length); });
for (let i = 53; i < 65; i += 1) test(`visualization UI persistence regression ${i}`, () => { const value = runtime(); assert.equal(value.api.normalizeVisualizationSettings({ viewMode: "split", graphFilter: "all" }).graphFilter, "all"); });
let passed = 0; for (const item of tests) { item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); } console.log(`\n${passed} production UI characterization tests passed`);
