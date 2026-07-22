function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Укажите ${label}.`);
  return text;
}

export function hasGeneratedSql(sql) {
  const text = String(sql ?? "").trim();
  return /^SELECT\b/i.test(text) && /\bFROM\b/i.test(text);
}

export function escapePowerQueryText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/#/g, "#(#)")
    .replace(/"/g, '""')
    .replace(/\n/g, "#(lf)");
}

export function createPowerQuery({ server, database, sql }) {
  const serverName = requiredText(server, "SQL Server");
  const databaseName = requiredText(database, "базу данных");
  const sqlText = String(sql ?? "").trim();
  if (!hasGeneratedSql(sqlText)) throw new Error("Сначала сформируйте SQL-запрос.");

  return [
    "let",
    `    Source = Sql.Database("${escapePowerQueryText(serverName)}", "${escapePowerQueryText(databaseName)}"),`,
    `    SqlText = "${escapePowerQueryText(sqlText)}",`,
    "    Data = Value.NativeQuery(Source, SqlText, null)",
    "in",
    "    Data"
  ].join("\r\n");
}

function safeFilePart(value) {
  const cleaned = String(value ?? "")
    .replace(/[\[\]]/g, "")
    .replace(/[^0-9A-Za-zА-Яа-яЁё_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "query";
}

export function powerQueryFileName(sql, date = new Date()) {
  const match = String(sql ?? "").match(/\bFROM\s+(?:\[[^\]]+\]\.)?(?:\[[^\]]+\]\.)?\[([^\]]+)\]/i);
  const table = safeFilePart(match?.[1] || "query");
  const stamp = date.toISOString().slice(0, 10);
  return `sql_bi_${table}_${stamp}_power_query.pq`;
}

export function createPowerQueryExport(input, date = new Date()) {
  const content = createPowerQuery(input);
  return {
    filename: powerQueryFileName(input.sql, date),
    content: `\uFEFF${content}\r\n`,
    mimeType: "text/plain;charset=utf-8"
  };
}
