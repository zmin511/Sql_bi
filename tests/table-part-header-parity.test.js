import assert from "node:assert/strict";

import {
  resolveTablePartHeaderJoin as coreResolveTablePartHeaderJoin
} from "../src/core/relationships.js";

import {
  loadProductionRuntime
} from "./helpers/load-production-runtime.js";

const { api } = loadProductionRuntime("index.html");

function row({
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
    const headerId = index === 0
      ? "header"
      : `header-${index + 1}`;

    rows.push(
      row({
        id: headerId,
        internal: headerTable,
        metadata: headerMetadata
      })
    );

    if (index === 0) {
      for (
        let keyIndex = 0;
        keyIndex < headerKeyCount;
        keyIndex += 1
      ) {
        rows.push(
          row({
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
    const detailId = index === 0
      ? "detail"
      : `detail-${index + 1}`;

    rows.push(
      row({
        id: detailId,
        internal: detailTable,
        parentId: detailParentId,
        metadata: detailMetadata
      })
    );

    if (index === 0) {
      for (
        let keyIndex = 0;
        keyIndex < detailKeyCount;
        keyIndex += 1
      ) {
        rows.push(
          row({
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

function childrenFromRows(rows) {
  const children = {};

  for (const item of rows) {
    if (!item.parentId) continue;
    if (!children[item.parentId]) children[item.parentId] = [];
    children[item.parentId].push(item);
  }

  return children;
}

function normalizeCandidates(candidates) {
  return Array.from(
    candidates || [],
    candidate => ({ ...candidate })
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}

function normalizeDiagnostics(diagnostics) {
  return Array.from(diagnostics || []).sort();
}

function normalizedResult(result) {
  return {
    matched: result.matched,
    unambiguous: result.unambiguous,
    headerTable: result.headerTable,
    detailTable: result.detailTable,
    headerKeyColumn: result.headerKeyColumn,
    detailForeignKeyColumn: result.detailForeignKeyColumn,
    reason: result.reason,
    candidates: normalizeCandidates(result.candidates),
    diagnostics: normalizeDiagnostics(result.diagnostics)
  };
}

const cases = [
  {
    name: "absent input",
    rows: [],
    input: null
  },
  {
    name: "explicit header-detail pair",
    rows: relationshipRows(),
    input: map => map.detail
  },
  {
    name: "string detail table",
    rows: relationshipRows(),
    input: "_Document100_VT1"
  },
  {
    name: "duplicate detail nodes",
    rows: relationshipRows({ detailCount: 2 }),
    input: "_Document100_VT1"
  },
  {
    name: "non-table-part input",
    rows: relationshipRows(),
    input: map => map.header
  },
  {
    name: "malformed physical name",
    rows: relationshipRows({
      detailTable: "_DocumentABC_VT1",
      detailKeyCount: 0
    }),
    input: map => map.detail
  },
  {
    name: "missing header",
    rows: relationshipRows({
      headerCount: 0,
      headerKeyCount: 0
    }),
    input: map => map.detail
  },
  {
    name: "duplicate headers",
    rows: relationshipRows({ headerCount: 2 }),
    input: map => map.detail
  },
  {
    name: "expected header conflict",
    rows: relationshipRows(),
    input: map => map.detail,
    context: {
      expectedHeaderTable: "_Document200"
    }
  },
  {
    name: "unconfirmed parent owner",
    rows: relationshipRows({
      detailParentId: "foreign-parent"
    }),
    input: map => map.detail
  },
  {
    name: "metadata mismatch",
    rows: relationshipRows({
      detailMetadata: "Документ.Другой"
    }),
    input: map => map.detail
  },
  {
    name: "missing header key",
    rows: relationshipRows({ headerKeyCount: 0 }),
    input: map => map.detail
  },
  {
    name: "duplicate header keys",
    rows: relationshipRows({ headerKeyCount: 2 }),
    input: map => map.detail
  },
  {
    name: "structural fallback without explicit detail key",
    rows: relationshipRows({ detailKeyCount: 0 }),
    input: map => map.detail
  },
  {
    name: "duplicate detail keys",
    rows: relationshipRows({ detailKeyCount: 2 }),
    input: map => map.detail
  },
  {
    name: "matching X suffixes",
    rows: relationshipRows({
      headerTable: "_Document100X2",
      detailTable: "_Document100X2_VT1X2",
      detailKeyCount: 0
    }),
    input: map => map.detail
  },
  {
    name: "conflicting X suffixes",
    rows: relationshipRows({
      headerTable: "_Document100X2",
      detailTable: "_Document100X2_VT1X3",
      detailKeyCount: 0
    }),
    input: map => map.detail
  }
];

let passed = 0;

for (const scenario of cases) {
  const rows = scenario.rows.map(item => ({ ...item }));

  api.importRows(rows.map(item => ({ ...item })));

  const map = Object.fromEntries(
    rows.map(item => [item.id, item])
  );

  const input = typeof scenario.input === "function"
    ? scenario.input(map)
    : scenario.input;

  const productionResult = api.resolveTablePartHeaderJoin(
    input,
    scenario.context || {}
  );

  const coreResult = coreResolveTablePartHeaderJoin(
    input,
    {
      rows,
      children: childrenFromRows(rows),
      ...(scenario.context || {})
    }
  );

  assert.deepEqual(
    normalizedResult(coreResult),
    normalizedResult(productionResult),
    `Core/production mismatch: ${scenario.name}`
  );

  passed += 1;
  console.log(`ok ${passed} - ${scenario.name}`);
}

console.log(`\n${passed} table-part header parity cases passed`);