export function sqlDateExpr(alias, column, type = "") {
  const expr = `${alias}.[${column}]`;
  const isDate = /_Date_Time$/i.test(column) || column === "_Date_Time" || /дата/i.test(String(type)) || /date|datetime/i.test(String(type).toLowerCase());
  return isDate ? `DATEADD(YEAR, -2000, ${expr})` : expr;
}

export function relativeDateBoundary(months, days, direction) {
  let expr = "GETDATE()";
  const monthCount = Math.max(0, Number(months || 0)) || 0;
  const dayCount = Math.max(0, Number(days || 0)) || 0;
  const sign = direction === "future" ? 1 : -1;
  if (monthCount > 0) expr = `DATEADD(MONTH, ${sign * monthCount}, ${expr})`;
  if (dayCount > 0) expr = `DATEADD(DAY, ${sign * dayCount}, ${expr})`;
  return expr;
}
