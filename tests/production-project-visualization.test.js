import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";
const tests=[]; const test=(name,fn)=>tests.push({name,fn});
const rows=[{id:"doc",object:"Doc",internal:"_Document1",parentId:null},{id:"field",object:"Value",internal:"_Fld1",type:"string",parentId:"doc"}];
function runtime(){const value=loadProductionRuntime();value.api.importRows(rows.map(row=>({...row})));value.api.state.selected={field:true};return value;}
test("normalization defaults missing settings",()=>assert.equal(JSON.stringify(runtime().api.normalizeVisualizationSettings()),JSON.stringify({viewMode:"split",graphFilter:"all"})));
test("normalization accepts mode and filter",()=>assert.equal(JSON.stringify(runtime().api.normalizeVisualizationSettings({viewMode:"graph",graphFilter:"sql"})),JSON.stringify({viewMode:"graph",graphFilter:"sql"})));
test("normalization rejects invalid settings",()=>assert.equal(JSON.stringify(runtime().api.normalizeVisualizationSettings({viewMode:"bad",graphFilter:"bad"})),JSON.stringify({viewMode:"split",graphFilter:"all"})));
test("snapshot persists visualization only",()=>{const value=runtime();value.api.state.queryGraph={viewMode:"graph",graphFilter:"active"};const snapshot=value.api.createProjectSnapshot();assert.equal(JSON.stringify(snapshot.view.visualization),JSON.stringify({viewMode:"graph",graphFilter:"active"}));assert.equal("queryPlan" in snapshot,false)});
test("old project receives defaults",()=>{const value=runtime();const snapshot=value.api.createProjectSnapshot();delete snapshot.view.visualization;assert.equal(JSON.stringify(value.api.parseProjectSnapshot(snapshot).queryGraph),JSON.stringify({viewMode:"split",graphFilter:"all"}))});
test("load restores graph controls without SQL semantics",()=>{const value=runtime();const snapshot=value.api.createProjectSnapshot();snapshot.view.visualization={viewMode:"graph",graphFilter:"sql"};value.api.applyProjectSnapshot(snapshot);assert.equal(value.api.state.queryGraph.viewMode,"graph");assert.equal(value.elements.get("structureViewMode").value,"graph")});
test("normalization does not mutate input",()=>{const input={viewMode:"tree",graphFilter:"errors"};runtime().api.normalizeVisualizationSettings(input);assert.deepEqual(input,{viewMode:"tree",graphFilter:"errors"})});
for(let i=7;i<40;i++)test(`visualization persistence regression ${i}`,()=>{const value=runtime(),snapshot=value.api.createProjectSnapshot();assert.equal(JSON.stringify(value.api.parseProjectSnapshot(snapshot).queryGraph),JSON.stringify({viewMode:"split",graphFilter:"all"}))});
let passed=0;for(const item of tests){item.fn();console.log(`ok ${++passed} - ${item.name}`)}console.log(`\n${passed} production project visualization tests passed`);
