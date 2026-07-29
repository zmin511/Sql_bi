import assert from "node:assert/strict";
import { generateSql } from "../src/core/sqlGenerate.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function fixture({
  chain,
  refDepth = 5,
  rowsOverride = null,
  selectedOverride = null
} = {}) {
  const rows = rowsOverride || [
    {
      id: "table-document",
      object: "Document",
      title: "Document",
      internal: "_Document100",
      parentId: null
    },
    {
      id: "field-employee",
      object: "Employee",
      title: "Employee",
      type: "Reference.Employees",
      internal: "_Fld100RRef",
      parentId: "table-document"
    },
    {
      id: "root-employees",
      object: "Employees",
      title: "Reference.Employees",
      type: "Reference.Employees",
      internal: "_Reference10",
      parentId: null
    },
    {
      id: "root-departments",
      object: "Departments",
      title: "Reference.Departments",
      type: "Reference.Departments",
      internal: "_Reference20",
      parentId: null
    }
  ];

  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  const syntheticId = "s:field-employee:1:_Reference10:_Description";

  const meta = {
    id: syntheticId,
    baseTopId: "field-employee",
    chain: chain === undefined
      ? [{
          refInternal: "_Fld100RRef",
          targetTable: "_Reference10",
          targetKind: "reference",
          targetType: "Reference.Employees",
          resolutionMethod: "exact_type"
        }]
      : chain,
    tableInternal: "_Reference10",
    field: {
      object: "Description",
      title: "Description",
      internal: "_Description",
      type: "String"
    },
    displayPath: "Employee.Description",
    displayPrefix: "Employee"
  };

  return {
    rows,
    byId,
    selected: selectedOverride || {
      [syntheticId]: true
    },
    metaById: {
      [syntheticId]: meta
    },
    schema: "dbo",
    refDepth
  };
}

test("valid synthetic reference chain generates one confirmed LEFT JOIN", () => {
  const result = generateSql(fixture());

  assert.match(
    result.sql,
    /FROM\s+\[dbo\]\.\[_Document100\]\s+AS\s+T/
  );

  assert.match(
    result.sql,
    /LEFT JOIN \[dbo\]\.\[_Reference10\] AS R1 ON R1\.\[_IDRRef\] = T\.\[_Fld100RRef\]/
  );

  assert.match(result.sql, /R1\.\[_Description\]/);
  assert.equal((result.sql.match(/LEFT JOIN/g) || []).length, 1);
});

test("missing target root blocks the whole SQL", () => {
  const result = generateSql(
    fixture({
      rowsOverride: [
        {
          id: "table-document",
          object: "Document",
          internal: "_Document100",
          parentId: null
        },
        {
          id: "field-employee",
          object: "Employee",
          internal: "_Fld100RRef",
          parentId: "table-document"
        }
      ]
    })
  );

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("not_found") &&
      item.includes("target_root_changed")
    ),
    true
  );
});

test("duplicate target roots block ambiguous reference SQL", () => {
  const input = fixture();

  input.rows.push({
    id: "root-employees-duplicate",
    object: "Employees duplicate",
    title: "Reference.Employees",
    type: "Reference.Employees",
    internal: "_Reference10",
    parentId: null
  });

  input.byId = Object.fromEntries(
    input.rows.map(row => [row.id, row])
  );

  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("ambiguous") &&
      item.includes("target_root_changed")
    ),
    true
  );
});

test("cycle blocks the whole SQL", () => {
  const result = generateSql(
    fixture({
      chain: [
        {
          refInternal: "_Fld100RRef",
          targetTable: "_Reference10",
          targetKind: "reference"
        },
        {
          refInternal: "_Fld200RRef",
          targetTable: "_reference10",
          targetKind: "reference"
        }
      ]
    })
  );

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("cycle") &&
      item.includes("repeated_target")
    ),
    true
  );
});

test("chain exceeding configured refDepth blocks SQL", () => {
  const result = generateSql(
    fixture({
      refDepth: 1,
      chain: [
        {
          refInternal: "_Fld100RRef",
          targetTable: "_Reference10",
          targetKind: "reference"
        },
        {
          refInternal: "_Fld200RRef",
          targetTable: "_Reference20",
          targetKind: "reference"
        }
      ]
    })
  );

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("max_depth") &&
      item.includes("chain_too_deep")
    ),
    true
  );
});

test("invalid technical target table blocks SQL", () => {
  const result = generateSql(
    fixture({
      chain: [{
        refInternal: "_Fld100RRef",
        targetTable: "_Reference10_VT1",
        targetKind: "reference"
      }]
    })
  );

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("invalid_target_table")
    ),
    true
  );
});

test("empty synthetic chain blocks SQL", () => {
  const result = generateSql(
    fixture({
      chain: []
    })
  );

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("unknown_type") &&
      item.includes("empty_chain")
    ),
    true
  );
});

test("ordinary physical field generation remains unchanged", () => {
  const input = fixture({
    selectedOverride: {
      "field-employee": true
    }
  });

  input.metaById = {};

  const result = generateSql(input);

  assert.match(result.sql, /T\.\[_Fld100RRef\]/);
  assert.equal(result.sql.includes("LEFT JOIN"), false);
});

test("missing metadata blocks synthetic-only selection", () => {
  const input = fixture();
  input.metaById = {};

  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("missing_metadata") &&
      item.includes("selected_meta_not_found")
    ),
    true
  );
  assert.equal(result.sql.includes("LEFT JOIN"), false);
});

test("missing metadata blocks mixed physical and synthetic selection", () => {
  const input = fixture({
    selectedOverride: {
      "field-employee": true,
      "missing-synthetic": true
    }
  });

  input.metaById = {};

  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("missing-synthetic") &&
      item.includes("missing_metadata")
    ),
    true
  );
  assert.equal(result.sql.includes("LEFT JOIN"), false);
});

test("metadata without field blocks synthetic-only selection", () => {
  const input = fixture();
  const syntheticId = Object.keys(input.selected)[0];

  input.metaById[syntheticId] = {
    id: syntheticId,
    baseTopId: "field-employee",
    chain: [{
      refInternal: "_Fld100RRef",
      targetTable: "_Reference10",
      targetKind: "reference"
    }]
  };

  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("malformed_metadata") &&
      item.includes("missing_field")
    ),
    true
  );
  assert.equal(result.sql.includes("LEFT JOIN"), false);
});

test("metadata without field blocks mixed selection", () => {
  const input = fixture();
  const syntheticId = Object.keys(input.selected)[0];

  input.selected["field-employee"] = true;
  delete input.metaById[syntheticId].field;

  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes(syntheticId) &&
      item.includes("missing_field")
    ),
    true
  );
  assert.equal(result.sql.includes("LEFT JOIN"), false);
});

test("one valid and one malformed synthetic item blocks the whole SQL", () => {
  const input = fixture();
  const validId = Object.keys(input.selected)[0];
  const malformedId = "s:malformed";

  input.selected[malformedId] = true;
  input.metaById[malformedId] = {
    id: malformedId,
    baseTopId: "field-employee",
    chain: [{
      refInternal: "_Fld100RRef",
      targetTable: "_Reference10",
      targetKind: "reference"
    }]
  };

  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes(malformedId) &&
      item.includes("missing_field")
    ),
    true
  );
  assert.equal(result.sql.includes("LEFT JOIN"), false);
  assert.equal(
    result.diagnostics.some(item =>
      item.includes(validId) &&
      item.includes("JOIN reference")
    ),
    false
  );
});

test("invalid chain preserves validation status and reason", () => {
  const result = generateSql(
    fixture({
      chain: [{
        refInternal: "_Fld100RRef",
        targetTable: "_Reference999",
        targetKind: "reference"
      }]
    })
  );

  assert.equal(result.sql, "");
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("not_found") &&
      item.includes("target_root_changed")
    ),
    true
  );
});

test("meta id cannot replace the selected synthetic id", () => {
  const input = fixture();
  const selectedId = Object.keys(input.selected)[0];

  input.metaById[selectedId].id = "forged-id";
  input.boolFilters = {
    [selectedId]: {
      yes: true,
      no: false
    },
    "forged-id": {
      yes: false,
      no: true
    }
  };
  input.metaById[selectedId].field.type = "boolean";

  const result = generateSql(input);

  assert.notEqual(result.sql, "");
  assert.equal(
    result.sql.includes("= 1"),
    true
  );
  assert.equal(
    result.sql.includes("= 0"),
    false
  );
  assert.equal(
    result.diagnostics.some(item =>
      item.includes("forged-id")
    ),
    false
  );
});
function createRefDepthInput({
  value,
  omit = false,
  chainLength
}) {
  const chain = [];

  for (let index = 1; index <= chainLength; index += 1) {
    chain.push({
      refInternal:
        index === 1
          ? "_Fld100RRef"
          : `_Fld${index}00RRef`,
      targetTable: `_Reference${index}0`,
      targetKind: "reference"
    });
  }

  const input = fixture({ chain });

  for (let index = 3; index <= chainLength; index += 1) {
    input.rows.push({
      id: `root-reference-${index}`,
      object: `Reference${index}`,
      title: `Reference.Reference${index}`,
      type: `Reference.Reference${index}`,
      internal: `_Reference${index}0`,
      parentId: null
    });
  }

  input.byId = Object.fromEntries(
    input.rows.map(row => [row.id, row])
  );

  input.metaById[Object.keys(input.selected)[0]].tableInternal =
    `_Reference${chainLength}0`;

  if (omit) {
    delete input.refDepth;
  } else {
    input.refDepth = value;
  }

  return input;
}

function assertDeterministic(first, second) {
  assert.equal(first.sql, second.sql);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.equal(first.hint || "", second.hint || "");
}

test("undefined refDepth defaults to production maximum five", () => {
  const input = createRefDepthInput({
    omit: true,
    chainLength: 5
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.notEqual(first.sql, "");
  assert.equal(
    (first.sql.match(/LEFT JOIN/g) || []).length,
    5
  );
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("Reference chain blocked")
    ),
    false
  );
  assertDeterministic(first, second);
});

test("zero refDepth defaults to production maximum five", () => {
  const input = createRefDepthInput({
    value: 0,
    chainLength: 5
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.notEqual(first.sql, "");
  assert.equal(
    (first.sql.match(/LEFT JOIN/g) || []).length,
    5
  );
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("max_depth")
    ),
    false
  );
  assertDeterministic(first, second);
});

test("negative refDepth clamps to one and blocks two-step chain", () => {
  const input = createRefDepthInput({
    value: -1,
    chainLength: 2
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.equal(first.sql, "");
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("max_depth") &&
      item.includes("chain_too_deep")
    ),
    true
  );
  assert.equal(first.sql.includes("LEFT JOIN"), false);
  assertDeterministic(first, second);
});

test("numeric string refDepth is converted to a number", () => {
  const input = createRefDepthInput({
    value: "2",
    chainLength: 2
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.notEqual(first.sql, "");
  assert.equal(
    (first.sql.match(/LEFT JOIN/g) || []).length,
    2
  );
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("max_depth")
    ),
    false
  );
  assertDeterministic(first, second);
});

test("invalid string refDepth defaults to production maximum five", () => {
  const input = createRefDepthInput({
    value: "abc",
    chainLength: 5
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.notEqual(first.sql, "");
  assert.equal(
    (first.sql.match(/LEFT JOIN/g) || []).length,
    5
  );
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("Reference chain blocked")
    ),
    false
  );
  assertDeterministic(first, second);
});

test("refDepth above production maximum clamps to five", () => {
  const input = createRefDepthInput({
    value: 6,
    chainLength: 5
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.notEqual(first.sql, "");
  assert.equal(
    (first.sql.match(/LEFT JOIN/g) || []).length,
    5
  );
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("max_depth")
    ),
    false
  );
  assertDeterministic(first, second);
});

test("refDepth above production maximum still blocks six-step chain", () => {
  const input = createRefDepthInput({
    value: 6,
    chainLength: 6
  });

  const first = generateSql(input);
  const second = generateSql(input);

  assert.equal(first.sql, "");
  assert.equal(
    first.diagnostics.some(item =>
      item.includes("max_depth") &&
      item.includes("chain_too_deep")
    ),
    true
  );
  assert.equal(first.sql.includes("LEFT JOIN"), false);
  assertDeterministic(first, second);
});

function multiReferenceInput({
  selectedOrder = ["s:employee:code", "s:employee:name"],
  metas = null,
  rows = null,
  extra = {}
} = {}) {
  const fixtureRows = rows || [
    { id: "document", object: "Document", internal: "_Document100", parentId: null },
    { id: "employee", object: "Employee", internal: "_Fld100RRef", parentId: "document" },
    { id: "department", object: "Department", internal: "_Fld200RRef", parentId: "document" },
    { id: "employee-root", object: "Employees", title: "Reference.Employees", type: "Reference.Employees", internal: "_Reference10", parentId: null },
    { id: "department-root", object: "Departments", title: "Reference.Departments", type: "Reference.Departments", internal: "_Reference20", parentId: null },
    { id: "company-root", object: "Companies", title: "Reference.Companies", type: "Reference.Companies", internal: "_Reference30", parentId: null }
  ];
  const defaultMetas = {
    "s:employee:code": {
      baseTopId: "employee",
      chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
      field: { internal: "_Code", object: "Code", title: "Code" },
      displayPath: "Employee.Code"
    },
    "s:employee:name": {
      baseTopId: "employee",
      chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
      field: { internal: "_Description", object: "Description", title: "Description" },
      displayPath: "Employee.Description"
    }
  };
  return {
    rows: fixtureRows,
    byId: Object.fromEntries(fixtureRows.map(row => [row.id, row])),
    selected: Object.fromEntries(selectedOrder.map(id => [id, true])),
    metaById: metas || defaultMetas,
    schema: "dbo",
    ...extra
  };
}

function joinLines(sql) {
  return sql.split("\n").filter(line => line.startsWith("LEFT JOIN"));
}

test("two synthetic fields with a shared prefix reuse one JOIN deterministically", () => {
  const first = generateSql(multiReferenceInput());
  const second = generateSql(multiReferenceInput({
    selectedOrder: ["s:employee:name", "s:employee:code"]
  }));

  const expectedJoin = "LEFT JOIN [dbo].[_Reference10] AS R1 ON R1.[_IDRRef] = T.[_Fld100RRef]";
  assert.deepEqual(joinLines(first.sql), [expectedJoin]);
  assert.equal((first.sql.match(/R1\.\[_Code\]/g) || []).length, 1);
  assert.equal((first.sql.match(/R1\.\[_Description\]/g) || []).length, 1);
  assert.match(first.sql, /R1\.\[_Code\] AS \[Employee\.Code\]/);
  assert.match(first.sql, /R1\.\[_Description\] AS \[Employee\.Description\]/);
  assert.equal(first.sql, second.sql);
  assert.deepEqual(first.diagnostics, second.diagnostics);
});

test("two independent synthetic chains allocate R1 and R2 deterministically", () => {
  const input = multiReferenceInput({
    selectedOrder: ["s:department:name", "s:employee:code"],
    metas: {
      "s:employee:code": {
        baseTopId: "employee",
        chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
        field: { internal: "_Code", object: "Code" }, displayPath: "Employee.Code"
      },
      "s:department:name": {
        baseTopId: "department",
        chain: [{ refInternal: "_Fld200RRef", targetTable: "_Reference20", targetKind: "reference" }],
        field: { internal: "_Description", object: "Description" }, displayPath: "Department.Description"
      }
    }
  });
  const first = generateSql(input);
  const second = generateSql({ ...input, selected: { "s:employee:code": true, "s:department:name": true } });

  assert.deepEqual(joinLines(first.sql), [
    "LEFT JOIN [dbo].[_Reference20] AS R1 ON R1.[_IDRRef] = T.[_Fld200RRef]",
    "LEFT JOIN [dbo].[_Reference10] AS R2 ON R2.[_IDRRef] = T.[_Fld100RRef]"
  ]);
  assert.match(first.sql, /R1\.\[_Description\] AS \[Department\.Description\]/);
  assert.match(first.sql, /R2\.\[_Code\] AS \[Employee\.Code\]/);
  assert.equal(first.sql, second.sql);
});

test("nested and separate synthetic chains keep physical paths and aliases distinct", () => {
  const input = multiReferenceInput({
    selectedOrder: ["s:nested", "s:separate"],
    metas: {
      "s:nested": {
        baseTopId: "employee",
        chain: [
          { refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" },
          { refInternal: "_Fld110RRef", targetTable: "_Reference30", targetKind: "reference" }
        ],
        field: { internal: "_Description", object: "Description" }, displayPath: "Employee.Company.Description"
      },
      "s:separate": {
        baseTopId: "employee",
        chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
        field: { internal: "_Code", object: "Code" }, displayPath: "Employee.Code"
      }
    }
  });
  const first = generateSql(input);
  const second = generateSql({ ...input, selected: { "s:separate": true, "s:nested": true } });

  assert.deepEqual(joinLines(first.sql), [
    "LEFT JOIN [dbo].[_Reference10] AS R1 ON R1.[_IDRRef] = T.[_Fld100RRef]",
    "LEFT JOIN [dbo].[_Reference30] AS R2 ON R2.[_IDRRef] = R1.[_Fld110RRef]"
  ]);
  assert.match(first.sql, /R2\.\[_Description\] AS \[Employee\.Company\.Description\]/);
  assert.match(first.sql, /R1\.\[_Code\] AS \[Employee\.Code\]/);
  assert.equal(first.sql, second.sql);
});

test("conflicting synthetic output names remain unique and cannot collide with R aliases", () => {
  const input = multiReferenceInput({
    selectedOrder: ["s:first", "s:second"],
    metas: {
      "s:first": {
        baseTopId: "employee", chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
        field: { internal: "_Code", object: "Value", title: "Value" }, displayPath: "Value"
      },
      "s:second": {
        baseTopId: "department", chain: [{ refInternal: "_Fld200RRef", targetTable: "_Reference20", targetKind: "reference" }],
        field: { internal: "_Code", object: "Value", title: "Value" }, displayPath: "Value"
      }
    }
  });
  const result = generateSql(input);

  assert.match(result.sql, /R1\.\[_Code\] AS \[Value\]/);
  assert.match(result.sql, /R2\.\[_Code\] AS \[Value \(2\)\]/);
  assert.equal((result.sql.match(/ AS \[Value(?: \(2\))?\]/g) || []).length, 2);
  assert.deepEqual(joinLines(result.sql).map(line => line.match(/ AS (R\d+) /)[1]), ["R1", "R2"]);
});

test("reference JOIN from detail coexists with one confirmed header-detail JOIN", () => {
  const rows = [
    { id: "header", object: "Header", internal: "_Document100", parentId: null },
    { id: "header-number", object: "Number", internal: "_Number", parentId: "header" },
    { id: "detail", object: "Detail", internal: "_Document100_VT1", parentId: "header" },
    { id: "detail-owner", object: "HeaderRef", internal: "_Document100_IDRRef", parentId: "detail" },
    { id: "detail-employee", object: "Employee", internal: "_Fld100RRef", parentId: "detail" },
    { id: "employee-root", object: "Employees", title: "Reference.Employees", type: "Reference.Employees", internal: "_Reference10", parentId: null }
  ];
  const relation = {
    matched: true, unambiguous: true,
    detailTable: "_Document100_VT1", headerTable: "_Document100",
    detailForeignKeyColumn: "_Document100_IDRRef", headerKeyColumn: "_IDRRef",
    candidates: [{ detailTable: "_Document100_VT1", headerTable: "_Document100", detailForeignKeyColumn: "_Document100_IDRRef", headerKeyColumn: "_IDRRef", confirmation: "explicit_columns" }]
  };
  const result = generateSql(multiReferenceInput({
    rows,
    selectedOrder: ["header-number", "s:detail:employee"],
    metas: {
      "s:detail:employee": {
        baseTopId: "detail-employee",
        chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
        field: { internal: "_Description", object: "Description" }, displayPath: "Employee.Description"
      }
    },
    extra: { resolveTablePartHeaderJoin: () => relation }
  }));

  assert.match(result.sql, /FROM  \[dbo\]\.\[_Document100_VT1\] AS T/);
  assert.match(result.sql, /LEFT JOIN \[dbo\]\.\[_Document100\] AS H ON T\.\[_Document100_IDRRef\] = H\.\[_IDRRef\]/);
  assert.match(result.sql, /LEFT JOIN \[dbo\]\.\[_Reference10\] AS R1 ON R1\.\[_IDRRef\] = T\.\[_Fld100RRef\]/);
  assert.equal((result.sql.match(/LEFT JOIN \[dbo\]\.\[_Document100\] AS H/g) || []).length, 1);
  assert.match(result.sql, /H\.\[_Number\]/);
  assert.match(result.sql, /R1\.\[_Description\] AS \[Employee\.Description\]/);
});

test("one invalid chain among multiple synthetic fields blocks all JOIN output", () => {
  const input = multiReferenceInput({
    selectedOrder: ["s:employee:code", "s:invalid"],
    metas: {
      "s:employee:code": {
        baseTopId: "employee", chain: [{ refInternal: "_Fld100RRef", targetTable: "_Reference10", targetKind: "reference" }],
        field: { internal: "_Code", object: "Code" }, displayPath: "Employee.Code"
      },
      "s:invalid": {
        baseTopId: "department", chain: [{ refInternal: "_Fld200RRef", targetTable: "_Reference999", targetKind: "reference" }],
        field: { internal: "_Description", object: "Description" }, displayPath: "Department.Description"
      }
    }
  });
  const result = generateSql(input);

  assert.equal(result.sql, "");
  assert.equal(result.sql.includes("LEFT JOIN"), false);
  assert.ok(result.diagnostics.some(item => item.includes("s:invalid") && item.includes("not_found")));
});
let passed = 0;

for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} reference SQL integration tests passed`);
