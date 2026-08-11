import assert from "node:assert/strict";
import { buildQueryPlanView } from "../src/core/queryPlanView.js";

const plan={status:"ready",reason:null,diagnostics:[],sqlParts:{empty:false},selections:[{id:"hf",sourceAlias:"H",sourceTable:"_Document1",sourceField:"_Number",outputAlias:"Number",expression:"H.[_Number]"},{id:"df",sourceAlias:"T",sourceTable:"_Document1_VT1",sourceField:"_Fld1",outputAlias:"Amount",expression:"T.[_Fld1]"},{id:"s",sourceAlias:"R1",sourceTable:"_Reference2",sourceField:"_Description",outputAlias:"Partner.Description",expression:"R1.[_Description]"}],joins:[{id:"hd",kind:"header_detail",status:"sql",sourceAlias:"T",sourceTable:"_Document1_VT1",sourceColumn:"_Document1_IDRRef",targetAlias:"H",targetTable:"_Document1",targetColumn:"_IDRRef",sql:"LEFT JOIN H ON T.k = H.k"},{id:"ref",kind:"reference",status:"sql",sourceAlias:"T",sourceTable:"_Document1_VT1",sourceColumn:"_Fld2RRef",targetAlias:"R1",targetTable:"_Reference2",targetColumn:"_IDRRef",sql:"LEFT JOIN R1 ON T.r = R1.k"}],filters:[{id:"f",fieldId:"df",operator:"gte",expression:"T.[_Fld1] >= 10"}]};
const view=buildQueryPlanView(plan);
assert.equal(view.status,"ready");assert.deepEqual(view.nodes.map(node=>node.alias),["H","T","R1"]);
assert.deepEqual(view.edges.map(edge=>[edge.sourceAlias,edge.targetAlias,edge.sourceColumn,edge.targetColumn]),[["T","H","_Document1_IDRRef","_IDRRef"],["T","R1","_Fld2RRef","_IDRRef"]]);
assert.equal(view.nodes.find(node=>node.alias==="T").filters.length,1);
assert.equal(buildQueryPlanView({status:"ready",sqlParts:{empty:true}}).status,"empty");
assert.equal(buildQueryPlanView({status:"blocked",reason:"ambiguous_context",diagnostics:["x"]}).status,"blocked");
assert.deepEqual(buildQueryPlanView(plan),buildQueryPlanView(plan));console.log("query plan view tests passed");
