import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const rows=[{id:"doc",internal:"_Document1",object:"Doc",parentId:null},{id:"field",internal:"_Fld1",object:"Value",type:"string",parentId:"doc"}];
function runtime(){const value=loadProductionRuntime();value.api.importRows(rows.map(row=>({...row})));value.api.state.selected={field:true};value.api.renderSQL();return value;}
test("graph panel exists",()=>assert.match(runtime().html,/id="queryGraphPanel"/));
test("graph mode exists",()=>assert.match(runtime().html,/id="structureViewMode"/));
test("graph filter exists",()=>assert.match(runtime().html,/id="queryGraphFilter"/));
test("graph SVG exists",()=>assert.match(runtime().html,/id="queryGraphSvg"/));
test("model is present",()=>assert.equal(typeof runtime().api.buildQueryGraphModel,"function"));
test("model has nodes",()=>assert.ok(runtime().api.buildQueryGraphModel({rows,selectedIds:["field"],queryPlan:runtime().api.state.queryPlan}).nodes.length));
test("model has tree edge",()=>assert.equal(runtime().api.buildQueryGraphModel({rows,selectedIds:[],queryPlan:null}).edges[0].kind,"tree"));
test("selected field is active",()=>assert.ok(runtime().api.buildQueryGraphModel({rows,selectedIds:["field"],queryPlan:null}).activeNodeIds.includes("row:field")));
test("model is deterministic",()=>{const value=runtime(),input={rows:value.api.state.rows,selectedIds:["field"],metaById:{},queryPlan:value.api.state.queryPlan};assert.deepEqual(value.api.buildQueryGraphModel(input),value.api.buildQueryGraphModel(input))});
test("renderer writes graph counts",()=>{const value=runtime();value.api.renderQueryGraph();assert.match(value.elements.get("queryGraphNodeCount").textContent,/Nodes/) });
let passed=0;for(const item of tests){item.fn();console.log(`ok ${++passed} - ${item.name}`)}console.log(`\n${passed} production query graph tests passed`);
