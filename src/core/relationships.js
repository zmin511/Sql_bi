import { isVTTableName } from "./tableDetect.js";

function physicalName(row) {
  return String((row && (row.internal || row.object)) || "");
}

function isRelationshipVTTableName(name) {
  const value = String(name || "");

  return (
    isVTTableName(value) &&
    /^(_Document|_Reference|_Catalog|_InfoRg|_AccumRg)\d+(X\d+)?_VT\d+(X\d+)?$/i.test(
      value
    )
  );
}

function normalizedPhysicalName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeReferenceName(value) {
  return String(value || "").trim().toLowerCase();
}

function isHeaderTableName(name) {
  return /^(_Document|_Reference|_Catalog|_InfoRg|_AccumRg)\d+(X\d+)?$/i.test(
    String(name || "")
  );
}

function directTableFields(tableNode, context) {
  if (!tableNode) return [];

  const children = context.children || {};
  if (Array.isArray(children[tableNode.id])) {
    return children[tableNode.id].filter(
      row => !isRelationshipVTTableName(physicalName(row))
    );
  }

  const rows = Array.isArray(context.rows) ? context.rows : [];
  return rows.filter(
    row =>
      row &&
      row.parentId === tableNode.id &&
      !isRelationshipVTTableName(physicalName(row))
  );
}

function tablePartOwnerSpec(detailTable) {
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

  const storageSuffix = detailSuffix || ownerSuffix;

  return {
    logicalOwner: match[1],
    storageSuffix,
    headerTable: match[1] + storageSuffix,
    detailForeignKeyColumn: match[1] + "_IDRRef"
  };
}

function emptyRelationshipResult() {
  return {
    matched: false,
    unambiguous: false,
    headerTable: null,
    detailTable: null,
    headerKeyColumn: null,
    detailForeignKeyColumn: null,
    reason: "unknown",
    candidates: [],
    diagnostics: []
  };
}

export function resolveTablePartHeaderJoin(tablePart, context = {}) {
  const result = emptyRelationshipResult();
  const rows = Array.isArray(context.rows) ? context.rows : [];

  const detailNodes = typeof tablePart === "string"
    ? rows.filter(
        row =>
          normalizedPhysicalName(physicalName(row)) ===
            normalizedPhysicalName(tablePart) &&
          isRelationshipVTTableName(physicalName(row))
      )
    : tablePart
      ? [tablePart]
      : [];

  if (detailNodes.length > 1) {
    result.reason = "multiple_detail_tables";
    result.candidates = detailNodes.map(row => ({
      detailTable: physicalName(row)
    }));
    result.diagnostics.push(
      `Найдено несколько структурных объектов одной табличной части (${detailNodes.length}). Автоматический выбор запрещён.`
    );
    return result;
  }

  const detailNode = detailNodes[0] || null;
  const detailTable = physicalName(detailNode);

  result.detailTable = detailTable || null;

  if (!detailNode || !isRelationshipVTTableName(detailTable)) {
    result.reason = "not_table_part";
    result.diagnostics.push(
      "Структурный объект не подтверждён как табличная часть. JOIN шапки намеренно не сформирован."
    );
    return result;
  }

  const ownerSpec = tablePartOwnerSpec(detailTable);
  const ownerName = ownerSpec && ownerSpec.headerTable;

  if (!ownerSpec || !ownerName) {
    result.reason = "invalid_detail_table_name";
    result.diagnostics.push(
      `Табличная часть ${detailTable || "<без имени>"} не имеет допустимого физического имени. JOIN намеренно не сформирован.`
    );
    return result;
  }

  const headerNodes = rows.filter(row => {
    const name = physicalName(row);

    return (
      isHeaderTableName(name) &&
      normalizedPhysicalName(name) === normalizedPhysicalName(ownerName)
    );
  });

  if (!headerNodes.length) {
    result.reason = "header_not_found";
    result.diagnostics.push(
      `Для табличной части ${detailTable} не найдена физическая таблица-шапка ${ownerName}. JOIN намеренно не сформирован.`
    );
    return result;
  }

  if (headerNodes.length > 1) {
    result.reason = "multiple_header_tables";
    result.candidates = headerNodes.map(header => ({
      detailTable,
      headerTable: physicalName(header)
    }));
    result.diagnostics.push(
      `Для табличной части ${detailTable} найдено несколько таблиц-шапок (${headerNodes.length}). Автоматический выбор запрещён.`
    );
    return result;
  }

  const headerNode = headerNodes[0];
  const headerTable = physicalName(headerNode);
  const expectedHeader = String(context.expectedHeaderTable || "");

  if (
    expectedHeader &&
    normalizedPhysicalName(expectedHeader) !==
      normalizedPhysicalName(headerTable)
  ) {
    result.reason = "header_metadata_conflict";
    result.candidates = [{ detailTable, headerTable }];
    result.diagnostics.push(
      `Метаданные противоречат друг другу: для ${detailTable} ожидалась шапка ${expectedHeader}, физическая структура указывает ${headerTable}. JOIN намеренно не сформирован.`
    );
    return result;
  }

  const structuralOwner = detailNode.parentId === headerNode.id;
  const detailMetadata = normalizeReferenceName(detailNode.metadata);
  const headerMetadata = normalizeReferenceName(headerNode.metadata);
  const businessOwner =
    !!detailMetadata &&
    detailMetadata === headerMetadata;

  if (!structuralOwner || !businessOwner) {
    result.reason = "owner_metadata_conflict";
    result.candidates = [{ detailTable, headerTable }];
    result.diagnostics.push(
      `Метаданные ${detailTable} не подтверждают единственного владельца ${headerTable}. JOIN намеренно не сформирован.`
    );
    return result;
  }

  const headerKeys = directTableFields(headerNode, context).filter(
    row => /^_IDRRef$/i.test(String(row.internal || ""))
  );

  if (headerKeys.length !== 1) {
    result.reason = headerKeys.length
      ? "multiple_header_key_columns"
      : "header_key_not_found";

    result.candidates = headerKeys.map(key => ({
      detailTable,
      headerTable,
      headerKeyColumn: String(key.internal || "")
    }));

    result.diagnostics.push(
      headerKeys.length
        ? `Для шапки ${headerTable} найдено несколько ключевых колонок _IDRRef (${headerKeys.length}). JOIN намеренно не сформирован.`
        : `В шапке ${headerTable} отсутствует подтверждённая физическая колонка _IDRRef. JOIN намеренно не сформирован.`
    );

    return result;
  }

  const expectedDetailKey = ownerSpec.detailForeignKeyColumn;

  const explicitDetailKeys = directTableFields(
    detailNode,
    context
  ).filter(
    row =>
      normalizedPhysicalName(row.internal) ===
      normalizedPhysicalName(expectedDetailKey)
  );

  if (explicitDetailKeys.length > 1) {
    result.reason = "multiple_detail_key_columns";

    result.candidates = explicitDetailKeys.map(key => ({
      detailTable,
      headerTable,
      headerKeyColumn: "_IDRRef",
      detailForeignKeyColumn: String(key.internal || "")
    }));

    result.diagnostics.push(
      `Для табличной части ${detailTable} найдено несколько колонок связи с ${headerTable}. JOIN намеренно не сформирован.`
    );

    return result;
  }

  const detailForeignKeyColumn =
    explicitDetailKeys.length === 1
      ? String(explicitDetailKeys[0].internal)
      : expectedDetailKey;

  const candidate = {
    detailTable,
    headerTable,
    headerKeyColumn: String(headerKeys[0].internal),
    detailForeignKeyColumn,
    confirmation:
      explicitDetailKeys.length === 1
        ? "explicit_columns"
        : "mxl_structural_owner"
  };

  result.candidates = [candidate];
  result.matched = true;
  result.unambiguous = true;
  result.headerTable = headerTable;
  result.headerKeyColumn = candidate.headerKeyColumn;
  result.detailForeignKeyColumn = detailForeignKeyColumn;
  result.reason = "resolved";

  return result;
}

export function validateRelationshipForSql(relationship) {
  const result = {
    valid: false,
    candidate: null,
    reason: "unknown_relationship",
    diagnostics: []
  };

  if (!relationship || !relationship.matched) {
    result.reason = "relationship_not_matched";
  } else if (!relationship.unambiguous) {
    result.reason = "relationship_ambiguous";
  } else {
    const candidates = (relationship.candidates || []).filter(
      candidate =>
        candidate &&
        candidate.detailTable === relationship.detailTable &&
        candidate.detailForeignKeyColumn === relationship.detailForeignKeyColumn &&
        candidate.headerTable === relationship.headerTable &&
        candidate.headerKeyColumn === relationship.headerKeyColumn
    );

    if (candidates.length !== 1) {
      result.reason = candidates.length
        ? "multiple_matching_candidates"
        : "matching_candidate_not_found";
    } else if (candidates[0].confirmation !== "explicit_columns") {
      result.reason = "physical_detail_foreign_key_not_confirmed";
    } else {
      return {
        valid: true,
        candidate: candidates[0],
        reason: "resolved",
        diagnostics: []
      };
    }
  }

  result.diagnostics.push(
    result.reason === "physical_detail_foreign_key_not_confirmed"
      ? "Связь найдена структурно, но физическая колонка связи табличной части не подтверждена. SQL намеренно не сформирован."
      : "Не найдена единственная подтверждённая физическая связь шапки и табличной части. SQL намеренно не сформирован."
  );
  return result;
}
