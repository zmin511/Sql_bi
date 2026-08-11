import assert from "node:assert/strict";
import { getAvailableRelatedFields } from "../src/core/graphAssistant.js";
import { generateSql } from "../src/core/sqlGenerate.js";

const tests=[]; const test=(name,fn)=>tests.push({name,fn});
const rows=[
  {id:"header",internal:"_Document1",object:"Document",parentId:null},
  {id:"partner",internal:"_Fld1RRef",object:"Partner",title:"Partner",type:"Справочник.Partners",parentId:"header"},
  {id:"owner",internal:"_Fld2RRef",object:"Owner",title:"Owner",type:"Справочник.Partners",parentId:"header"},
  {id:"partners",internal:"_Reference1",object:"Partners",type:"Справочник.Partners",parentId:null},
  {id:"name",internal:"_Fld3",object:"Name",title:"Name",type:"Строка",parentId:"partners"},
  {id:"ambiguous",internal:"_Fld4RRef",object:"Ambiguous",type:"Справочник.Partners;Справочник.Other",parentId:"header"}
];
test("confirmed reference exposes canonical related fields",()=>{const relations=getAvailableRelatedFields({rows,selectedIds:["partner"]});assert.equal(relations.length,1);assert.equal(relations[0].sourceRowId,"partner");assert.equal(relations[0].targetTable,"_Reference1");assert.deepEqual(relations[0].fields.map(field=>field.internal),["_Description","_Code","_Fld3"]);});
test("different source relations retain distinct action identities",()=>{const relations=getAvailableRelatedFields({rows,selectedIds:["partner","owner"]});assert.equal(relations.length,2);assert.notEqual(relations[0].id,relations[1].id);});
test("ambiguous relation is not actionable",()=>assert.equal(getAvailableRelatedFields({rows,selectedIds:["ambiguous"]}).length,0));
test("unselected relation is not listed",()=>assert.equal(getAvailableRelatedFields({rows,selectedIds:[]}).length,0));
test("adding through one same-target relation creates only its canonical join",()=>{const sourceRows=[{id:"doc",internal:"_Document1",object:"Document",parentId:null},{id:"a",internal:"_Fld1RRef",object:"A",type:"Reference.X",parentId:"doc"},{id:"b",internal:"_Fld2RRef",object:"B",type:"Reference.X",parentId:"doc"},{id:"target",internal:"_Reference1",object:"X",type:"Reference.X",parentId:null}];const id="s:a:1:_Reference1:_Code",result=generateSql({rows:sourceRows,byId:Object.fromEntries(sourceRows.map(row=>[row.id,row])),selected:{[id]:true},metaById:{[id]:{baseTopId:"a",chain:[{refInternal:"_Fld1RRef",targetTable:"_Reference1",targetKind:"reference"}],tableInternal:"_Reference1",field:{internal:"_Code",object:"Code",title:"Code",type:"string"}}}});assert.equal(result.plan.joins.filter(join=>join.kind==="reference").length,1);assert.match(result.sql,/T\.\[_Fld1RRef\]/);assert.doesNotMatch(result.sql,/_Fld2RRef/);assert.match(result.sql,/R1\.\[_Code\]/);});
let passed=0,failed=0;for(const item of tests){try{item.fn();console.log(`ok ${++passed} - ${item.name}`)}catch(error){failed++;console.error(`not ok - ${item.name}`);console.error(error);}}if(failed)throw new Error(`${failed} graph assistant tests failed`);console.log(`\n${passed} graph assistant tests passed`);
