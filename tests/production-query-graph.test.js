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
test("renderer writes graph counts",()=>{const value=runtime();value.api.renderQueryGraph();assert.match(value.elements.get("queryGraphNodeCount").textContent,/Узлов/) });
test("tree edge is classified as available",()=>{const value=runtime();const model=value.api.buildQueryGraphModel({rows,selectedIds:[],queryPlan:null});const edge=model.edges.find(e=>e.kind==="tree");assert.ok(edge);assert.equal(value.api.normalizeRelationshipStatus(edge,model),"available");});
test("active selected field node is active-sql",()=>{const value=runtime();const model=value.api.buildQueryGraphModel({rows,selectedIds:["field"],queryPlan:null});const node=model.nodes.find(n=>n.id==="row:field");assert.ok(node);assert.equal(value.api.normalizeRelationshipStatus(node,model),"active-sql");});
test("active filter shows only active edges/nodes",()=>{const value=runtime();value.api.state.queryGraph.graphFilter="active";value.api.renderQueryGraph();assert.match(value.elements.get("queryGraphNodes").innerHTML,/row:field/);});
test("focus reset clears presentation focus",()=>{const value=runtime();value.api.setQueryGraphFocus("node","row:field");assert.equal(value.api.state.queryGraphFocus.id,"row:field");value.api.clearQueryGraphFocus();assert.equal(value.api.state.queryGraphFocus.id,null);});
test("details card includes relationship kind",()=>{const value=runtime();const model=value.api.buildQueryGraphModel({rows,selectedIds:[],queryPlan:null});const edge=model.edges[0];const details=value.api.buildRelationshipDetails(edge,model);assert.ok(details.some(row=>row.label==="Тип"));});

let passed=0;for(const item of tests){item.fn();console.log(`ok ${++passed} - ${item.name}`)}console.log(`\n${passed} production query graph tests passed`);
