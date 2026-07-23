import { isBoolType } from "./types.js";

export function castExpr(alias, column, type = "") {
  const expr = alias ? `${alias}.[${column}]` : `[${column}]`;
  const isDate = /_Date_Time$/i.test(column) || column === "_Date_Time" || /дата/i.test(String(type)) || /date|datetime/i.test(String(type).toLowerCase());
  if (isDate) return `DATEADD(YEAR, -2000, ${expr})`;
  if (/RRef$/i.test(column) || /_IDRRef$/i.test(column)) return `CAST(${expr} AS uniqueidentifier)`;
  if (isBoolType(type)) return `CAST(${expr} AS int)`;
  if (/int|number|numeric/.test(String(type).toLowerCase())) return `CAST(${expr} AS int)`;
  return expr;
}

function normalizeTypeName(typeString) {
  return String(typeString || "").trim().replace(/\s+/g, " ");
}

function isCompositeType(typeString) {
  return normalizeTypeName(typeString).includes(";");
}

export function parseNumericType(typeString) {
  const original = String(typeString || "");
  const normalized = normalizeTypeName(original);
  const composite = isCompositeType(normalized);
  const numericWord =
    /(?:^|[;\s])(?:число|numeric|decimal)(?=$|[;\s(+\d])/iu.test(
      normalized
    );

  if (composite) {
    return {
      matched: false,
      precision: null,
      scale: null,
      unsigned: false,
      reason: numericWord ? "composite_type" : "not_numeric",
      composite: true
    };
  }

  let match = normalized.match(
    /^число\s*(\+)?\s*(\d+)\s*\.\s*(\d+)$/iu
  );

  if (!match) {
    match = normalized.match(
      /^(?:numeric|decimal)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/iu
    );
  }

  if (!match) {
    match = normalized.match(
      /^(?:numeric|decimal)\s+(\d+)\s*\.\s*(\d+)$/iu
    );
  }

  if (!match) {
    return {
      matched: false,
      precision: null,
      scale: null,
      unsigned: false,
      reason: numericWord
        ? "unknown_numeric_format"
        : "not_numeric",
      composite: false
    };
  }

  const isOneC = /^число/iu.test(normalized);
  const unsigned =
    isOneC &&
    match.length === 4 &&
    match[1] === "+";

  const precision = Number(
    isOneC ? match[2] : match[1]
  );

  const scale = Number(
    isOneC ? match[3] : match[2]
  );

  if (
    !Number.isInteger(precision) ||
    precision < 1 ||
    precision > 38
  ) {
    return {
      matched: false,
      precision,
      scale,
      unsigned,
      reason: "invalid_precision",
      composite: false
    };
  }

  if (
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > precision
  ) {
    return {
      matched: false,
      precision,
      scale,
      unsigned,
      reason: "invalid_scale",
      composite: false
    };
  }

  return {
    matched: true,
    precision,
    scale,
    unsigned,
    reason: "ok",
    composite: false
  };
}
