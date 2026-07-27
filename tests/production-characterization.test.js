import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assertSafeRange(range, expression) {
  assert.equal(range.active, true);
  assert.equal(range.conditions.length, 2);
  assert.equal(range.conditions[0], `${expression} >= ${range.lower}`);
  assert.equal(
    range.conditions[1],
    `${expression} < ${range.upperExclusive}`
  );
}

const runtime = loadProductionRuntime("index.html");
const { api, elements } = runtime;

test("production selectability rejects structural and parent nodes", () => {
  assert.equal(
    api.isSelectableField(
      { internal: "_Fld123" },
      { kind: "orig", hasOriginalChildren: false }
    ),
    true
  );

  assert.equal(
    api.isSelectableField(
      { internal: "_Document100" },
      { kind: "orig", hasOriginalChildren: false }
    ),
    false
  );

  assert.equal(
    api.isSelectableField(
      { internal: "_Fld123" },
      { kind: "orig", hasOriginalChildren: true }
    ),
    false
  );

  assert.equal(
    api.isSelectableField(
      { internal: "_Description" },
      { kind: "synth", hasOriginalChildren: true }
    ),
    true
  );
});

test("production numeric parser preserves precision and scale", () => {
  const oneCInteger = api.parseNumericType("Число 15.0");
  assert.equal(oneCInteger.matched, true);
  assert.equal(oneCInteger.precision, 15);
  assert.equal(oneCInteger.scale, 0);

  const oneCFraction = api.parseNumericType("Число +15.2");
  assert.equal(oneCFraction.matched, true);
  assert.equal(oneCFraction.precision, 15);
  assert.equal(oneCFraction.scale, 2);
  assert.equal(oneCFraction.unsigned, true);

  const decimal = api.parseNumericType("decimal(38, 10)");
  assert.equal(decimal.matched, true);
  assert.equal(decimal.precision, 38);
  assert.equal(decimal.scale, 10);

  const invalid = api.parseNumericType("decimal(39, 0)");
  assert.equal(invalid.matched, false);
  assert.equal(invalid.reason, "invalid_precision");
});

test("production relative periods always have two safe boundaries", () => {
  const expression = "DATEADD(YEAR, -2000, T.[_Date_Time])";

  const past = api.buildRelativeDateRange(
    {
      pastMonths: 2,
      pastDays: 10,
      futureMonths: 0,
      futureDays: 0
    },
    expression
  );

  assertSafeRange(past, expression);
  assert.match(past.lower, /DATEADD\(MONTH, -2,/);
  assert.match(past.lower, /DATEADD\(DAY, -10,/);
  assert.equal(
    past.upperExclusive,
    "DATEADD(DAY, 1, CAST(GETDATE() AS date))"
  );

  const future = api.buildRelativeDateRange(
    {
      pastMonths: 0,
      pastDays: 0,
      futureMonths: 1,
      futureDays: 5
    },
    expression
  );

  assertSafeRange(future, expression);
  assert.equal(future.lower, "CAST(GETDATE() AS date)");
  assert.match(future.upperExclusive, /^DATEADD\(DAY, 1, /);
});

test("production manual period validates dates and includes end day", () => {
  const expression = "DATEADD(YEAR, -2000, T.[_Date_Time])";

  const valid = api.buildManualDateRange(
    expression,
    "2026-07-01",
    "2026-07-21"
  );

  assert.equal(valid.active, true);
  assert.equal(valid.valid, true);
  assert.deepEqual(
    Array.from(valid.conditions),
    [
      `${expression} >= CAST('2026-07-01' AS date)`,
      `${expression} < DATEADD(DAY, 1, CAST('2026-07-21' AS date))`
    ]
  );

  const impossibleDate = api.buildManualDateRange(
    expression,
    "2026-02-30",
    "2026-03-01"
  );

  assert.equal(impossibleDate.active, false);
  assert.equal(impossibleDate.requested, true);
  assert.equal(impossibleDate.valid, false);
  assert.equal(impossibleDate.conditions.length, 0);

  const reversed = api.buildManualDateRange(
    expression,
    "2026-07-22",
    "2026-07-21"
  );

  assert.equal(reversed.active, false);
  assert.equal(reversed.valid, false);
  assert.equal(reversed.conditions.length, 0);
});

test("production selection context handles empty and manual modes", () => {
  const empty = api.resolveSelectionContext([]);
  assert.equal(empty.valid, false);
  assert.equal(empty.reason, "empty_selection");

  const manual = api.resolveSelectionContext(
    [],
    { manualFrom: "_Document100" }
  );

  assert.equal(manual.matched, true);
  assert.equal(manual.valid, true);
  assert.equal(manual.mode, "manual");
  assert.equal(manual.basePhysicalTable, "_Document100");

  const invalidManual = api.resolveSelectionContext(
    [],
    { manualFrom: "   " }
  );

  assert.equal(invalidManual.valid, false);
  assert.equal(invalidManual.reason, "invalid_manual_from");
});

test("production table-part resolver rejects absent input", () => {
  const result = api.resolveTablePartHeaderJoin(null);

  assert.equal(result.matched, false);
  assert.equal(result.unambiguous, false);
  assert.equal(result.reason, "not_table_part");
  assert.equal(result.headerTable, null);
  assert.equal(result.detailTable, null);
});

test("production renderSQL safely handles empty selection", () => {
  api.renderSQL();

  const sql = elements.get("sql");
  const selectedCount = elements.get("selCount");

  assert.ok(sql);
  assert.match(sql.value, /^-- /);
  assert.equal(selectedCount.textContent, 0);
});


// STEP02I_TABLE_PART_HEADER_CHARACTERIZATION
function relationshipRow({
  id,
  internal,
  parentId = null,
  metadata = "",
  title = internal,
  type = ""
}) {
  return {
    id,
    object: internal,
    internal,
    title,
    type,
    metadata,
    parentId
  };
}

function relationshipRows(options = {}) {
  const {
    detailTable = "_Document100_VT1",
    headerTable = "_Document100",
    detailMetadata = "Документ.Заказ",
    headerMetadata = "Документ.Заказ",
    detailParentId = "header",
    headerCount = 1,
    detailCount = 1,
    headerKeyCount = 1,
    detailKeyCount = 1
  } = options;

  const rows = [];

  for (let index = 0; index < headerCount; index += 1) {
    const headerId = index === 0 ? "header" : `header-${index + 1}`;

    rows.push(
      relationshipRow({
        id: headerId,
        internal: headerTable,
        metadata: headerMetadata
      })
    );

    if (index === 0) {
      for (let keyIndex = 0; keyIndex < headerKeyCount; keyIndex += 1) {
        rows.push(
          relationshipRow({
            id: `header-key-${keyIndex + 1}`,
            internal: "_IDRRef",
            parentId: headerId,
            metadata: headerMetadata
          })
        );
      }
    }
  }

  for (let index = 0; index < detailCount; index += 1) {
    const detailId = index === 0 ? "detail" : `detail-${index + 1}`;

    rows.push(
      relationshipRow({
        id: detailId,
        internal: detailTable,
        parentId: detailParentId,
        metadata: detailMetadata
      })
    );

    if (index === 0) {
      for (let keyIndex = 0; keyIndex < detailKeyCount; keyIndex += 1) {
        rows.push(
          relationshipRow({
            id: `detail-key-${keyIndex + 1}`,
            internal: "_Document100_IDRRef",
            parentId: detailId,
            metadata: detailMetadata
          })
        );
      }
    }
  }

  return rows;
}

function importRelationshipRows(rows) {
  api.importRows(rows.map(row => ({ ...row })));
}

function stableRelationshipShape(result) {
  return {
    matched: result.matched,
    unambiguous: result.unambiguous,
    headerTable: result.headerTable,
    detailTable: result.detailTable,
    headerKeyColumn: result.headerKeyColumn,
    detailForeignKeyColumn: result.detailForeignKeyColumn,
    reason: result.reason,
    candidates: JSON.parse(JSON.stringify(result.candidates || [])),
    diagnostics: Array.from(result.diagnostics || [])
  };
}

const tablePartCharacterizationCases = [
  {
    name: "production table-part resolver rejects absent input",
    rows: [],
    input: null,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: null,
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "not_table_part",
      candidateCount: 0
    }
  },
  {
    name: "production table-part resolver resolves explicit header-detail pair",
    rows: relationshipRows(),
    input: rowMap => rowMap.detail,
    expected: {
      matched: true,
      unambiguous: true,
      headerTable: "_Document100",
      detailTable: "_Document100_VT1",
      headerKeyColumn: "_IDRRef",
      detailForeignKeyColumn: "_Document100_IDRRef",
      reason: "resolved",
      candidateCount: 1,
      confirmation: "explicit_columns"
    }
  },
  {
    name: "production table-part resolver accepts string detail table",
    rows: relationshipRows(),
    input: "_Document100_VT1",
    expected: {
      matched: true,
      unambiguous: true,
      headerTable: "_Document100",
      detailTable: "_Document100_VT1",
      headerKeyColumn: "_IDRRef",
      detailForeignKeyColumn: "_Document100_IDRRef",
      reason: "resolved",
      candidateCount: 1,
      confirmation: "explicit_columns"
    }
  },
  {
    name: "production table-part resolver rejects duplicate detail nodes",
    rows: relationshipRows({ detailCount: 2 }),
    input: "_Document100_VT1",
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: null,
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "multiple_detail_tables",
      candidateCount: 2
    }
  },
  {
    name: "production table-part resolver rejects non-table-part input",
    rows: relationshipRows(),
    input: rowMap => rowMap.header,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "not_table_part",
      candidateCount: 0
    }
  },
  {
    name: "production table-part resolver treats malformed physical name as non-table-part",
    rows: relationshipRows({
      detailTable: "_DocumentABC_VT1",
      detailKeyCount: 0
    }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_DocumentABC_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "not_table_part",
      candidateCount: 0
    }
  },
  {
    name: "production table-part resolver reports missing header",
    rows: relationshipRows({ headerCount: 0, headerKeyCount: 0 }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "header_not_found",
      candidateCount: 0
    }
  },
  {
    name: "production table-part resolver rejects duplicate headers",
    rows: relationshipRows({ headerCount: 2 }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "multiple_header_tables",
      candidateCount: 2
    }
  },
  {
    name: "production table-part resolver rejects expected header conflict",
    rows: relationshipRows(),
    input: rowMap => rowMap.detail,
    context: {
      expectedHeaderTable: "_Document200"
    },
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "header_metadata_conflict",
      candidateCount: 1
    }
  },
  {
    name: "production table-part resolver rejects unconfirmed parent owner",
    rows: relationshipRows({ detailParentId: "foreign-parent" }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "owner_metadata_conflict",
      candidateCount: 1
    }
  },
  {
    name: "production table-part resolver rejects metadata mismatch",
    rows: relationshipRows({
      detailMetadata: "Документ.Другой"
    }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "owner_metadata_conflict",
      candidateCount: 1
    }
  },
  {
    name: "production table-part resolver reports missing header key",
    rows: relationshipRows({ headerKeyCount: 0 }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "header_key_not_found",
      candidateCount: 0
    }
  },
  {
    name: "production table-part resolver rejects duplicate header keys",
    rows: relationshipRows({ headerKeyCount: 2 }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "multiple_header_key_columns",
      candidateCount: 2
    }
  },
  {
    name: "production table-part resolver uses structural fallback without explicit detail key",
    rows: relationshipRows({ detailKeyCount: 0 }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: true,
      unambiguous: true,
      headerTable: "_Document100",
      detailTable: "_Document100_VT1",
      headerKeyColumn: "_IDRRef",
      detailForeignKeyColumn: "_Document100_IDRRef",
      reason: "resolved",
      candidateCount: 1,
      confirmation: "mxl_structural_owner"
    }
  },
  {
    name: "production table-part resolver rejects duplicate detail keys",
    rows: relationshipRows({ detailKeyCount: 2 }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100_VT1",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "multiple_detail_key_columns",
      candidateCount: 2
    }
  },
  {
    name: "production table-part resolver resolves matching X suffixes",
    rows: relationshipRows({
      headerTable: "_Document100X2",
      detailTable: "_Document100X2_VT1X2",
      detailKeyCount: 0
    }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: true,
      unambiguous: true,
      headerTable: "_Document100X2",
      detailTable: "_Document100X2_VT1X2",
      headerKeyColumn: "_IDRRef",
      detailForeignKeyColumn: "_Document100_IDRRef",
      reason: "resolved",
      candidateCount: 1,
      confirmation: "mxl_structural_owner"
    }
  },
  {
    name: "production table-part resolver rejects conflicting X suffixes",
    rows: relationshipRows({
      headerTable: "_Document100X2",
      detailTable: "_Document100X2_VT1X3",
      detailKeyCount: 0
    }),
    input: rowMap => rowMap.detail,
    expected: {
      matched: false,
      unambiguous: false,
      headerTable: null,
      detailTable: "_Document100X2_VT1X3",
      headerKeyColumn: null,
      detailForeignKeyColumn: null,
      reason: "invalid_detail_table_name",
      candidateCount: 0
    }
  }
];

for (const scenario of tablePartCharacterizationCases) {
  test(scenario.name, () => {
    importRelationshipRows(scenario.rows);

    const rowMap = Object.fromEntries(
      scenario.rows.map(row => [row.id, row])
    );

    const input = typeof scenario.input === "function"
      ? scenario.input(rowMap)
      : scenario.input;

    const result = api.resolveTablePartHeaderJoin(
      input,
      scenario.context || {}
    );

    const shape = stableRelationshipShape(result);
    const expected = scenario.expected;

    assert.equal(shape.matched, expected.matched);
    assert.equal(shape.unambiguous, expected.unambiguous);
    assert.equal(shape.headerTable, expected.headerTable);
    assert.equal(shape.detailTable, expected.detailTable);
    assert.equal(shape.headerKeyColumn, expected.headerKeyColumn);
    assert.equal(
      shape.detailForeignKeyColumn,
      expected.detailForeignKeyColumn
    );
    assert.equal(shape.reason, expected.reason);
    assert.equal(shape.candidates.length, expected.candidateCount);
    assert.ok(Array.isArray(shape.diagnostics));

    if (expected.confirmation) {
      assert.equal(
        shape.candidates[0] && shape.candidates[0].confirmation,
        expected.confirmation
      );
    }

    console.log(
      `production relationship: ${scenario.name}: ${JSON.stringify(shape)}`
    );
  });
}

let passed = 0;

for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} production characterization tests passed`);