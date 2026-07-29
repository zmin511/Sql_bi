import assert from "node:assert/strict";
import { generateSql } from "../src/core/sqlGenerate.js";
import { validateRelationshipForSql } from "../src/core/relationships.js";
import { buildTree } from "../src/core/tree.js";

function relation(confirmation = "explicit_columns", candidates = null) {
  const candidate = {
    detailTable: "_Document100_VT1",
    detailForeignKeyColumn: "_Document100_IDRRef",
    headerTable: "_Document100",
    headerKeyColumn: "_IDRRef",
    confirmation
  };
  return {
    matched: true, unambiguous: true,
    detailTable: candidate.detailTable,
    detailForeignKeyColumn: candidate.detailForeignKeyColumn,
    headerTable: candidate.headerTable,
    headerKeyColumn: candidate.headerKeyColumn,
    candidates: candidates || [candidate], diagnostics: []
  };
}

function headerDetailRows({ detailKey = true } = {}) {
  const rows = [
    { id: "h", internal: "_Document100", object: "Header", metadata: "Document.Order", parentId: null },
    { id: "hf", internal: "_Number", object: "Number", title: "Number", parentId: "h" },
    { id: "hk", internal: "_IDRRef", object: "Ref", parentId: "h" },
    { id: "d", internal: "_Document100_VT1", object: "Detail", metadata: "Document.Order", parentId: "h" },
    { id: "df", internal: "_Fld100", object: "Quantity", title: "Quantity", type: "int", parentId: "d" }
  ];
  if (detailKey) rows.push({ id: "dk", internal: "_Document100_IDRRef", object: "HeaderRef", parentId: "d" });
  return rows;
}

function input(rows, selected, extra = {}) {
  return { rows, byId: buildTree(rows).byId, selected, schema: "dbo", ...extra };
}

function noSql(result) {
  assert.equal(result.sql, "");
  assert.ok(result.diagnostics.length);
}

{
  const rows = headerDetailRows();
  let calls = 0;
  const result = generateSql(input(rows, { hf: true, df: true }, {
    resolveTablePartHeaderJoin() { calls += 1; return relation(); }
  }));
  assert.equal(calls, 1);
  assert.match(result.sql, /FROM  \[dbo\]\.\[_Document100_VT1\] AS T/);
  assert.match(result.sql, /LEFT JOIN \[dbo\]\.\[_Document100\] AS H/);
  assert.equal((result.sql.match(/LEFT JOIN \[dbo\]\.\[_Document100\] AS H/g) || []).length, 1);
}

{
  const rows = headerDetailRows({ detailKey: false });
  noSql(generateSql(input(rows, { hf: true, df: true })));
}

{
  const rows = headerDetailRows();
  noSql(generateSql(input(rows, { hf: true, df: true }, {
    resolveTablePartHeaderJoin() { return relation("mxl_structural_owner"); }
  })));
}

{
  const rows = headerDetailRows();
  const duplicate = relation("explicit_columns", [
    ...relation().candidates,
    { ...relation().candidates[0] }
  ]);
  assert.equal(validateRelationshipForSql(duplicate).valid, false);
  noSql(generateSql(input(rows, { hf: true, df: true }, {
    resolveTablePartHeaderJoin() { return relation("explicit_columns", []); }
  })));
}

{
  const rows = headerDetailRows({ detailKey: false });
  assert.match(generateSql(input(rows, { df: true })).sql, /FROM  \[dbo\]\.\[_Document100_VT1\] AS T/);
}

{
  const rows = [
    { id: "a", internal: "_Document1", object: "A", parentId: null },
    { id: "af", internal: "_Fld1", object: "A", parentId: "a" },
    { id: "b", internal: "_Reference2", object: "B", parentId: null },
    { id: "bf", internal: "_Fld2", object: "B", parentId: "b" }
  ];
  noSql(generateSql(input(rows, { af: true, bf: true })));
}

{
  const unknown = { id: "u", internal: "_FldUnknown", object: "Unknown", parentId: null };
  noSql(generateSql(input([unknown], { u: true })));
}

{
  const rows = headerDetailRows();
  rows[0] = { ...rows[0], internal: "_Document200" };
  noSql(generateSql(input(rows, { hf: true, df: true })));
}

{
  const rows = headerDetailRows();
  rows.push(
    { id: "d2", internal: "_Document100_VT2", object: "Detail2", metadata: "Document.Order", parentId: "h" },
    { id: "d2f", internal: "_Fld200", object: "Quantity2", parentId: "d2" }
  );
  noSql(generateSql(input(rows, { df: true, d2f: true })));
}

{
  const rows = headerDetailRows();
  noSql(generateSql(input(rows, { hf: true, df: true }, {
    resolveTablePartHeaderJoin() {
      return { matched: false, unambiguous: false, reason: "ambiguous", candidates: [], diagnostics: ["ambiguous"] };
    }
  })));
}

{
  const rows = [
    { id: "d", internal: "_Document100", object: "Document", parentId: null },
    { id: "f", internal: "_Fld100RRef", object: "Customer", parentId: "d" },
    { id: "r", internal: "_Reference200", object: "Customers", parentId: null }
  ];
  const result = generateSql(input(rows, { synth: true }, {
    metaById: {
      synth: {
        id: "synth",
        baseTopId: "f",
        field: { internal: "_Description", object: "Description", type: "string" },
        displayPath: "Customer.Description",
        chain: [{
          refInternal: "_Fld100RRef",
          targetTable: "_Reference200",
          targetKind: "reference"
        }]
      }
    }
  }));
  assert.match(result.sql, /FROM  \[dbo\]\.\[_Document100\] AS T/);
  assert.match(result.sql, /LEFT JOIN \[dbo\]\.\[_Reference200\] AS R1/);
}

{
  const row = { id: "x", internal: "_Fld1", object: "Value", title: "Value", parentId: null };
  assert.match(generateSql(input([row], { x: true }, { fromTable: "dbo._ManualView" })).sql, /FROM  \[dbo\]\.\[dbo\._ManualView\] AS F/);
  noSql(generateSql(input([row], { x: true }, { fromTable: "   " })));
  assert.equal(generateSql(input([row], {}, { fromTable: "_ManualView" })).sql, "-- Select at least one field");
  assert.match(generateSql(input([row], { x: true }, { fromTable: "_ManualView" })).sql, /FROM  \[dbo\]\.\[_ManualView\] AS F/);
}

console.log("13 selection-context integration tests passed");
