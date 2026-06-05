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
