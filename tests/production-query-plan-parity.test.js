import assert from "node:assert/strict";
import { generateSql } from "../src/core/sqlGenerate.js";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const tests=[]; const test=(name,fn)=>tests.push({name,fn});
const rows=[{id:"doc",internal:"_Document100",object:"Order",parentId:null},{id:"field",internal:"_Fld100",object:"Name",type:"string",parentId:"doc"}];
function runtime(){const value=loadProductionRuntime(); value.api.importRows(rows.map(row=>({...row}))); value.api.state.selected={field:true}; value.api.renderSQL(); return value;}
const norm=value=>JSON.parse(JSON.stringify(value));
test("canonical namespace is used",()=>assert.equal(typeof runtime().canonicalCore.generateSql,"function"));
test("production stores query plan",()=>assert.equal(runtime().api.state.queryPlan.status,"ready"));
test("production stores query result",()=>assert.ok(runtime().api.state.queryResult));
test("mapper returns state rows",()=>assert.equal(runtime().api.buildCanonicalInputFromState().rows.length,2));
test("mapper copies selected map",()=>assert.notEqual(runtime().api.buildCanonicalInputFromState().selected,runtime().api.state.selected));
test("physical SQL parity",()=>{const value=runtime();assert.equal(value.elements.get("sql").value,generateSql(value.api.buildCanonicalInputFromState()).sql)});
test("embedded SQL parity",()=>{const value=runtime();assert.equal(value.elements.get("sql").value,value.canonicalCore.generateSql(value.api.buildCanonicalInputFromState()).sql)});
test("plan parity",()=>{const value=runtime();assert.deepEqual(norm(value.api.state.queryPlan),norm(value.canonicalCore.generateSql(value.api.buildCanonicalInputFromState()).plan))});
test("panel exists",()=>assert.match(runtime().html,/id="queryPlanPanel"/));
test("panel status exists",()=>assert.ok(runtime().elements.get("queryPlanStatus")));
test("panel counts exists",()=>assert.match(runtime().elements.get("queryPlanCounts").textContent,/Поля/));
test("panel joins exists",()=>assert.ok(runtime().elements.get("queryPlanJoins")));
test("empty selection retains placeholder",()=>{const value=runtime();value.api.state.selected={};value.api.renderSQL();assert.match(value.elements.get("sql").value,/Выберите/)});
test("empty selection has ready plan",()=>{const value=runtime();value.api.state.selected={};value.api.renderSQL();assert.equal(value.api.state.queryPlan.status,"ready")});
test("repeat render is deterministic",()=>{const value=runtime(),first=value.elements.get("sql").value;value.api.renderSQL();assert.equal(value.elements.get("sql").value,first)});
test("repeat render creates a new result",()=>{const value=runtime(),first=value.api.state.queryResult;value.api.renderSQL();assert.notEqual(value.api.state.queryResult,first)});
test("mapper does not mutate rows",()=>{const value=runtime(),before=JSON.stringify(value.api.state.rows);value.api.buildCanonicalInputFromState();assert.equal(JSON.stringify(value.api.state.rows),before)});
test("mapper preserves refDepth",()=>assert.equal(runtime().api.buildCanonicalInputFromState().refDepth,5));
test("mapper preserves schema",()=>{const value=runtime();value.api.state.schema="dbo";assert.equal(value.api.buildCanonicalInputFromState().schema,"dbo")});
test("canonical diagnostics drive DOM",()=>{const value=runtime();assert.equal(typeof value.elements.get("diag").textContent,"string")});
let passed=0;for(const item of tests){item.fn();console.log(`ok ${++passed} - ${item.name}`)}console.log(`\n${passed} production query-plan parity tests passed`);
