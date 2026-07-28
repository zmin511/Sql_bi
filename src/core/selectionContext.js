import {
  isVTTableName,
  tableFor as coreTableFor
} from "./tableDetect.js";

import {
  resolveTablePartHeaderJoin as coreResolveTablePartHeaderJoin
} from "./relationships.js";

function normalizedPhysicalName(value) {
  return String(value || "").trim().toLowerCase();
}

function tablePartOwnerName(detailTable) {
  const match = String(detailTable || "").match(
    /^((?:_Document|_Reference|_Catalog|_InfoRg|_AccumRg)\d+)(X\d+)?_VT\d+(X\d+)?$/i
  );

  if (!match) return null;

  const ownerSuffix = match[2] || "";
  const detailSuffix = match[3] || "";

  if (
    ownerSuffix &&
    detailSuffix &&
    normalizedPhysicalName(ownerSuffix) !==
      normalizedPhysicalName(detailSuffix)
  ) {
    return null;
  }

  return match[1] + (detailSuffix || ownerSuffix);
}

export function selectionObjectDescriptor(item, context = {}) {
  const byId = context.byId || {};

  const tableResolver =
    context.tableResolver ||
    context.tableFor ||
    (row => coreTableFor(row, byId));

  const kind =
    item && item.kind === "synth"
      ? "synth"
      : "orig";

  const row =
    (item && item.row) ||
    null;

  const meta =
    (item && item.meta) ||
    null;

  const originRow =
    kind === "synth"
      ? byId[meta && meta.baseTopId]
      : row;

  const tableNode =
    (item && item.tableNode) ||
    (originRow
      ? tableResolver(originRow)
      : null);

  const table = String(
    (item && item.physicalTable) ||
    (
      tableNode &&
      (tableNode.internal || tableNode.object)
    ) ||
    ""
  );

  const tableId = String(
    (item && item.objectId) ||
    (tableNode && tableNode.id) ||
    ""
  );

  const fieldId = String(
    (item && item.id) ||
    (row && row.id) ||
    (meta && meta.id) ||
    ""
  );

  const fieldName = String(
    (
      row &&
      (row.title || row.object || row.internal)
    ) ||
    fieldId ||
    "<неизвестное поле>"
  );

  const objectName = String(
    (
      tableNode &&
      (
        tableNode.title ||
        tableNode.object ||
        tableNode.internal
      )
    ) ||
    table ||
    "<неизвестный объект>"
  );

  const role =
    kind === "synth"
      ? "Rn"
      : isVTTableName(table)
        ? "T"
        : "base";

  return {
    kind,
    row,
    meta,
    originRow,
    tableNode,
    table,
    tableId,
    fieldId,
    fieldName,
    objectName,
    role,
    physicalKey: [
      normalizedPhysicalName(context.database || ""),
      normalizedPhysicalName(context.schema || ""),
      normalizedPhysicalName(table),
      role
    ].join("|")
  };
}

export function resolveSelectionContext(
  selectedFields,
  context = {}
) {
  const result = {
    matched: false,
    valid: false,
    mode: "unknown",
    baseObject: null,
    basePhysicalTable: null,
    headerObject: null,
    detailObject: null,
    allowedObjectIds: [],
    allowedPhysicalTables: [],
    rejectedFields: [],
    relationships: [],
    reason: "unknown",
    diagnostics: []
  };

  const items = (
    Array.isArray(selectedFields)
      ? selectedFields
      : []
  )
    .map(item =>
      selectionObjectDescriptor(item, context)
    )
    .sort(
      (left, right) =>
        left.physicalKey.localeCompare(
          right.physicalKey
        ) ||
        left.fieldId.localeCompare(right.fieldId)
    );

  result.fields = items;

  if (context.manualFrom) {
    const manualTable = String(
      context.manualFrom || ""
    );

    result.matched = !!manualTable.trim();
    result.valid = result.matched;
    result.mode = "manual";
    result.basePhysicalTable =
      manualTable || null;

    result.allowedObjectIds = Array.from(
      new Set(
        items
          .map(item => item.tableId)
          .filter(Boolean)
      )
    ).sort();

    result.allowedPhysicalTables =
      manualTable
        ? [manualTable]
        : [];

    result.reason =
      result.valid
        ? "manual_from"
        : "invalid_manual_from";

    if (!result.valid) {
      result.diagnostics.push(
        "Ручной FROM не имеет допустимого физического имени."
      );
    }

    return result;
  }

  const unknown = items.filter(
    item => !item.table || !item.tableId
  );

  if (unknown.length) {
    result.reason = "unknown_physical_origin";

    result.rejectedFields = unknown.map(item => ({
      id: item.fieldId,
      field: item.fieldName,
      object: item.objectName,
      physicalTable: item.table || null,
      reason: result.reason
    }));

    result.diagnostics.push(
      `Не удалось однозначно определить физическое происхождение полей: ${unknown
        .map(item => item.fieldName)
        .join(", ")}.`
    );

    return result;
  }

  const objects = [];
  const seen = new Set();

  for (const item of items) {
    const key =
      `${item.tableId}|` +
      normalizedPhysicalName(item.table);

    if (seen.has(key)) continue;

    seen.add(key);

    objects.push({
      id: item.tableId,
      table: item.table,
      node: item.tableNode,
      name: item.objectName,
      key
    });
  }

  objects.sort(
    (left, right) =>
      normalizedPhysicalName(left.table)
        .localeCompare(
          normalizedPhysicalName(right.table)
        ) ||
      left.id.localeCompare(right.id)
  );

  if (!objects.length) {
    result.reason = "empty_selection";
    return result;
  }

  const allow = (
    mode,
    base,
    header = null,
    detail = null,
    relationship = null
  ) => {
    result.matched = true;
    result.valid = true;
    result.mode = mode;

    result.baseObject =
      (base && base.node) ||
      null;

    result.basePhysicalTable =
      (base && base.table) ||
      null;

    result.headerObject =
      (header && header.node) ||
      null;

    result.detailObject =
      (detail && detail.node) ||
      null;

    result.allowedObjectIds = objects
      .map(object => object.id)
      .sort();

    result.allowedPhysicalTables = objects
      .map(object => object.table)
      .sort(
        (left, right) =>
          normalizedPhysicalName(left)
            .localeCompare(
              normalizedPhysicalName(right)
            )
      );

    result.relationships =
      relationship
        ? [relationship]
        : [];

    result.reason = "resolved";

    return result;
  };

  if (objects.length === 1) {
    const only = objects[0];
    const isDetail = isVTTableName(only.table);

    return allow(
      isDetail ? "detail" : "single",
      only,
      null,
      isDetail ? only : null
    );
  }

  const details = objects.filter(
    object => isVTTableName(object.table)
  );

  const headers = objects.filter(
    object => !isVTTableName(object.table)
  );

  if (
    objects.length === 2 &&
    details.length === 1 &&
    headers.length === 1
  ) {
    const detail = details[0];
    const header = headers[0];

    const expectedHeader =
      tablePartOwnerName(detail.table);

    if (
      expectedHeader &&
      normalizedPhysicalName(expectedHeader) ===
        normalizedPhysicalName(header.table)
    ) {
      const resolver =
        context.relationshipResolver ||
        context.resolveTablePartHeaderJoin ||
        (
          (
            tablePart,
            resolverContext = {}
          ) =>
            coreResolveTablePartHeaderJoin(
              tablePart,
              {
                rows: Array.isArray(context.rows)
                  ? context.rows
                  : [],
                children:
                  context.children || {},
                ...resolverContext
              }
            )
        );

      const relationship = resolver(
        detail.node || detail.table,
        {
          expectedHeaderTable: header.table
        }
      );

      if (
        relationship &&
        relationship.matched &&
        relationship.unambiguous
      ) {
        return allow(
          "header_detail",
          detail,
          header,
          detail,
          relationship
        );
      }

      result.reason =
        (
          relationship &&
          relationship.reason
        ) ||
        "unconfirmed_header_detail";

      for (
        const message of
        (
          relationship &&
          relationship.diagnostics
        ) ||
        []
      ) {
        result.diagnostics.push(message);
      }
    } else {
      result.reason = "foreign_header";
    }
  } else if (details.length > 1) {
    const firstOwner = tablePartOwnerName(
      details[0].table
    );

    result.reason = details.every(
      detail =>
        normalizedPhysicalName(
          tablePartOwnerName(detail.table)
        ) ===
        normalizedPhysicalName(firstOwner)
    )
      ? "multiple_details_same_header"
      : "multiple_independent_details";
  } else {
    result.reason =
      "independent_physical_tables";
  }

  const base = objects[0];

  result.baseObject =
    base.node || null;

  result.basePhysicalTable =
    base.table;

  const conflictingKeys = new Set(
    objects
      .slice(1)
      .map(object => object.key)
  );

  result.rejectedFields = items
    .filter(item =>
      conflictingKeys.has(
        `${item.tableId}|` +
        normalizedPhysicalName(item.table)
      )
    )
    .map(item => ({
      id: item.fieldId,
      field: item.fieldName,
      object: item.objectName,
      physicalTable: item.table,
      reason: result.reason
    }));

  const reasonText =
    result.reason ===
      "multiple_details_same_header"
      ? "две табличные части одной шапки создают риск ложного перемножения 1:N × 1:N"
      : result.reason === "foreign_header"
        ? "табличная часть не принадлежит выбранной шапке"
        : "между объектами нет однозначно подтверждённой связи";

  result.diagnostics.push(
    "Выбраны поля из независимых физических таблиц. Автоматическое объединение заблокировано. Оставьте поля одного объекта либо подтверждённой связки шапка–табличная часть."
  );

  result.diagnostics.push(
    `Базовый объект: ${base.name} (${base.table}).`
  );

  for (const object of objects.slice(1)) {
    const fields = items
      .filter(
        item =>
          item.tableId === object.id &&
          normalizedPhysicalName(item.table) ===
            normalizedPhysicalName(object.table)
      )
      .map(item => item.fieldName);

    result.diagnostics.push(
      `Конфликтующий объект: ${object.name} (${object.table}); поля: ${fields.join(", ")}; причина: ${reasonText}.`
    );
  }

  return result;
}
