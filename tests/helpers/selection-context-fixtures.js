function row({
  id,
  internal,
  parentId = null,
  title = internal,
  object = title,
  type = "",
  metadata = ""
}) {
  return {
    id,
    object,
    internal,
    title,
    type,
    metadata,
    parentId
  };
}

function field(id, parentId, title = id) {
  return row({
    id,
    internal: `_Fld_${id}`,
    parentId,
    title,
    object: title
  });
}

function tableForFixture(sourceRow, byId) {
  let current = sourceRow;
  let tableNode = null;

  while (current) {
    const name = String(current.internal || current.object || "");

    if (
      /^(_Document|_Reference|_Catalog|_InfoRg|_AccumRg)[0-9A-Za-z_]+_VT/i.test(name)
    ) {
      tableNode = current;
    } else if (
      !tableNode &&
      /^(_Document|_Reference|_Catalog|_InfoRg|_AccumRg|_Enum)[0-9A-Za-z_]+/i.test(name)
    ) {
      tableNode = current;
    }

    if (!current.parentId) break;
    current = byId[current.parentId];
  }

  return tableNode;
}

function buildFixture(rows) {
  const byId = Object.fromEntries(rows.map(item => [item.id, item]));
  const children = {};

  for (const item of rows) {
    if (!item.parentId) continue;
    if (!children[item.parentId]) children[item.parentId] = [];
    children[item.parentId].push(item);
  }

  return {
    rows,
    byId,
    children,
    tableFor(sourceRow) {
      return tableForFixture(sourceRow, byId);
    }
  };
}

function orig(rowValue, overrides = {}) {
  return {
    kind: "orig",
    row: rowValue,
    ...overrides
  };
}

function relationship({
  matched = true,
  unambiguous = true,
  reason = "resolved",
  confirmation = "explicit_columns",
  diagnostics = []
} = {}) {
  return {
    matched,
    unambiguous,
    headerTable: "_Document100",
    detailTable: "_Document100_VT1",
    headerKeyColumn: "_IDRRef",
    detailForeignKeyColumn: "_Document100_IDRRef",
    reason,
    candidates: matched
      ? [{
          detailTable: "_Document100_VT1",
          headerTable: "_Document100",
          headerKeyColumn: "_IDRRef",
          detailForeignKeyColumn: "_Document100_IDRRef",
          confirmation
        }]
      : [],
    diagnostics
  };
}

function baseRows() {
  const header = row({
    id: "header",
    internal: "_Document100",
    title: "Заказ"
  });

  const headerField = field(
    "header-field",
    "header",
    "Дата"
  );

  const detail = row({
    id: "detail",
    internal: "_Document100_VT1",
    parentId: "header",
    title: "Товары"
  });

  const detailField = field(
    "detail-field",
    "detail",
    "Номенклатура"
  );

  return {
    header,
    headerField,
    detail,
    detailField
  };
}

function makeScenario({
  name,
  rows = [],
  selectedFields = [],
  context = {},
  expected
}) {
  const fixture = buildFixture(rows);

  return {
    name,
    selectedFields,
    context: {
      rows: fixture.rows,
      byId: fixture.byId,
      children: fixture.children,
      tableFor: fixture.tableFor,
      ...context
    },
    expected
  };
}

export function selectionContextScenarios() {
  const common = baseRows();

  const foreignHeader = row({
    id: "foreign-header",
    internal: "_Document200",
    title: "Другой документ"
  });

  const foreignHeaderField = field(
    "foreign-header-field",
    "foreign-header",
    "Чужое поле"
  );

  const independent = row({
    id: "independent",
    internal: "_Reference300",
    title: "Справочник"
  });

  const independentField = field(
    "independent-field",
    "independent",
    "Наименование"
  );

  const detailTwo = row({
    id: "detail-two",
    internal: "_Document100_VT2",
    parentId: "header",
    title: "Услуги"
  });

  const detailTwoField = field(
    "detail-two-field",
    "detail-two",
    "Услуга"
  );

  const otherHeader = row({
    id: "other-header",
    internal: "_Document200",
    title: "Другой документ"
  });

  const otherDetail = row({
    id: "other-detail",
    internal: "_Document200_VT1",
    parentId: "other-header",
    title: "Другая табличная часть"
  });

  const otherDetailField = field(
    "other-detail-field",
    "other-detail",
    "Другое поле"
  );

  const unknownField = row({
    id: "unknown-field",
    internal: "_FldUnknown",
    title: "Неизвестное поле"
  });

  const duplicateLogicalHeader = row({
    id: "header-copy",
    internal: "_Document100",
    title: "Копия логического узла"
  });

  const duplicateLogicalField = field(
    "header-copy-field",
    "header-copy",
    "Поле копии"
  );

  const syntheticRow = row({
    id: "synthetic-field-row",
    internal: "_Description",
    title: "Наименование"
  });

  const syntheticItem = {
    kind: "synth",
    id: "synthetic-selection",
    row: syntheticRow,
    meta: {
      id: "synthetic-meta",
      baseTopId: common.detailField.id
    }
  };

  return [
    makeScenario({
      name: "empty selection",
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "empty_selection"
      }
    }),
    makeScenario({
      name: "manualFrom empty string stays automatic",
      context: {
        manualFrom: ""
      },
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "empty_selection"
      }
    }),
    makeScenario({
      name: "manualFrom whitespace enters invalid manual mode",
      context: {
        manualFrom: "   "
      },
      expected: {
        matched: false,
        valid: false,
        mode: "manual",
        reason: "invalid_manual_from",
        basePhysicalTable: "   ",
        allowedPhysicalTables: ["   "]
      }
    }),
    makeScenario({
      name: "valid manual mode",
      rows: [common.header, common.headerField],
      selectedFields: [orig(common.headerField)],
      context: {
        manualFrom: "_ManualView"
      },
      expected: {
        matched: true,
        valid: true,
        mode: "manual",
        reason: "manual_from",
        basePhysicalTable: "_ManualView",
        allowedObjectIds: ["header"],
        allowedPhysicalTables: ["_ManualView"]
      }
    }),
    makeScenario({
      name: "manual mode accepts unknown-origin fields",
      rows: [unknownField],
      selectedFields: [orig(unknownField)],
      context: {
        manualFrom: "_ManualView"
      },
      expected: {
        matched: true,
        valid: true,
        mode: "manual",
        reason: "manual_from",
        allowedObjectIds: [],
        allowedPhysicalTables: ["_ManualView"]
      }
    }),
    makeScenario({
      name: "manual mode accepts empty selection",
      context: {
        manualFrom: "_ManualView"
      },
      expected: {
        matched: true,
        valid: true,
        mode: "manual",
        reason: "manual_from",
        allowedObjectIds: [],
        allowedPhysicalTables: ["_ManualView"]
      }
    }),
    makeScenario({
      name: "unknown physical origin fails closed",
      rows: [common.header, common.headerField, unknownField],
      selectedFields: [
        orig(common.headerField),
        orig(unknownField)
      ],
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "unknown_physical_origin",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "single non-detail object",
      rows: [common.header, common.headerField],
      selectedFields: [orig(common.headerField)],
      expected: {
        matched: true,
        valid: true,
        mode: "single",
        reason: "resolved",
        basePhysicalTable: "_Document100",
        allowedObjectIds: ["header"],
        allowedPhysicalTables: ["_Document100"]
      }
    }),
    makeScenario({
      name: "single detail object",
      rows: [
        common.header,
        common.detail,
        common.detailField
      ],
      selectedFields: [orig(common.detailField)],
      expected: {
        matched: true,
        valid: true,
        mode: "detail",
        reason: "resolved",
        basePhysicalTable: "_Document100_VT1",
        allowedObjectIds: ["detail"],
        allowedPhysicalTables: ["_Document100_VT1"]
      }
    }),
    makeScenario({
      name: "header-detail explicit relationship",
      rows: [
        common.header,
        common.headerField,
        common.detail,
        common.detailField
      ],
      selectedFields: [
        orig(common.headerField),
        orig(common.detailField)
      ],
      context: {
        resolveTablePartHeaderJoin() {
          return relationship({
            confirmation: "explicit_columns"
          });
        }
      },
      expected: {
        matched: true,
        valid: true,
        mode: "header_detail",
        reason: "resolved",
        basePhysicalTable: "_Document100_VT1",
        relationshipConfirmation: "explicit_columns"
      }
    }),
    makeScenario({
      name: "header-detail structural fallback parity",
      rows: [
        common.header,
        common.headerField,
        common.detail,
        common.detailField
      ],
      selectedFields: [
        orig(common.headerField),
        orig(common.detailField)
      ],
      context: {
        resolveTablePartHeaderJoin() {
          return relationship({
            confirmation: "mxl_structural_owner"
          });
        }
      },
      expected: {
        matched: true,
        valid: true,
        mode: "header_detail",
        reason: "resolved",
        basePhysicalTable: "_Document100_VT1",
        relationshipConfirmation: "mxl_structural_owner"
      }
    }),
    makeScenario({
      name: "foreign header",
      rows: [
        foreignHeader,
        foreignHeaderField,
        common.detail,
        common.detailField
      ],
      selectedFields: [
        orig(foreignHeaderField),
        orig(common.detailField)
      ],
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "foreign_header",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "independent physical tables",
      rows: [
        common.header,
        common.headerField,
        independent,
        independentField
      ],
      selectedFields: [
        orig(common.headerField),
        orig(independentField)
      ],
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "independent_physical_tables",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "multiple details of same header",
      rows: [
        common.header,
        common.detail,
        common.detailField,
        detailTwo,
        detailTwoField
      ],
      selectedFields: [
        orig(common.detailField),
        orig(detailTwoField)
      ],
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "multiple_details_same_header",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "multiple independent details",
      rows: [
        common.header,
        common.detail,
        common.detailField,
        otherHeader,
        otherDetail,
        otherDetailField
      ],
      selectedFields: [
        orig(common.detailField),
        orig(otherDetailField)
      ],
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "multiple_independent_details",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "ambiguous relationship",
      rows: [
        common.header,
        common.headerField,
        common.detail,
        common.detailField
      ],
      selectedFields: [
        orig(common.headerField),
        orig(common.detailField)
      ],
      context: {
        resolveTablePartHeaderJoin() {
          return relationship({
            matched: false,
            unambiguous: false,
            reason: "unconfirmed_header_detail",
            diagnostics: ["ambiguous relationship"]
          });
        }
      },
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "unconfirmed_header_detail",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "relationship reason passthrough",
      rows: [
        common.header,
        common.headerField,
        common.detail,
        common.detailField
      ],
      selectedFields: [
        orig(common.headerField),
        orig(common.detailField)
      ],
      context: {
        resolveTablePartHeaderJoin() {
          return relationship({
            matched: false,
            unambiguous: false,
            reason: "header_key_not_found",
            diagnostics: ["header key missing"]
          });
        }
      },
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "header_key_not_found",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "synthetic field uses base field physical ownership",
      rows: [
        common.header,
        common.detail,
        common.detailField
      ],
      selectedFields: [syntheticItem],
      context: {
        database: "UMC",
        schema: "dbo"
      },
      expected: {
        matched: true,
        valid: true,
        mode: "detail",
        reason: "resolved",
        basePhysicalTable: "_Document100_VT1",
        fieldRole: "Rn",
        physicalKey: "umc|dbo|_document100_vt1|Rn"
      }
    }),
    makeScenario({
      name: "duplicate selected fields are preserved",
      rows: [common.header, common.headerField],
      selectedFields: [
        orig(common.headerField),
        orig(common.headerField)
      ],
      expected: {
        matched: true,
        valid: true,
        mode: "single",
        reason: "resolved",
        fieldCount: 2
      }
    }),
    makeScenario({
      name: "same physical table with different logical node IDs",
      rows: [
        common.header,
        common.headerField,
        duplicateLogicalHeader,
        duplicateLogicalField
      ],
      selectedFields: [
        orig(common.headerField),
        orig(duplicateLogicalField)
      ],
      expected: {
        matched: false,
        valid: false,
        mode: "unknown",
        reason: "independent_physical_tables",
        rejectedCount: 1
      }
    }),
    makeScenario({
      name: "deterministic field ordering",
      rows: [
        common.header,
        common.headerField,
        common.detail,
        common.detailField
      ],
      selectedFields: [
        orig(common.headerField, { id: "z-field" }),
        orig(common.detailField, { id: "a-field" })
      ],
      context: {
        resolveTablePartHeaderJoin() {
          return relationship();
        },
        database: "UMC",
        schema: "dbo"
      },
      expected: {
        matched: true,
        valid: true,
        mode: "header_detail",
        reason: "resolved",
        orderedFieldIds: ["a-field", "z-field"]
      }
    })
  ];
}

function normalizeNode(node) {
  if (!node) return null;

  return {
    id: String(node.id || ""),
    internal: String(node.internal || ""),
    object: String(node.object || ""),
    title: String(node.title || ""),
    parentId: node.parentId == null
      ? null
      : String(node.parentId)
  };
}

function normalizeDescriptor(item) {
  return {
    kind: item.kind,
    row: normalizeNode(item.row),
    meta: item.meta
      ? JSON.parse(JSON.stringify(item.meta))
      : null,
    originRow: normalizeNode(item.originRow),
    tableNode: normalizeNode(item.tableNode),
    table: item.table,
    tableId: item.tableId,
    fieldId: item.fieldId,
    fieldName: item.fieldName,
    objectName: item.objectName,
    role: item.role,
    physicalKey: item.physicalKey
  };
}

export function stableSelectionContextResult(result) {
  return {
    matched: result.matched,
    valid: result.valid,
    mode: result.mode,
    baseObject: normalizeNode(result.baseObject),
    basePhysicalTable: result.basePhysicalTable,
    headerObject: normalizeNode(result.headerObject),
    detailObject: normalizeNode(result.detailObject),
    allowedObjectIds: Array.from(result.allowedObjectIds || []),
    allowedPhysicalTables: Array.from(
      result.allowedPhysicalTables || []
    ),
    rejectedFields: JSON.parse(
      JSON.stringify(result.rejectedFields || [])
    ),
    relationships: JSON.parse(
      JSON.stringify(result.relationships || [])
    ),
    reason: result.reason,
    diagnostics: Array.from(result.diagnostics || []),
    fields: Array.from(
      result.fields || [],
      normalizeDescriptor
    )
  };
}


