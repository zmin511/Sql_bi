import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "index.html");
const modules = ["sqlIdentifiers.js", "types.js", "tableDetect.js", "relationships.js", "references.js", "selectionContext.js", "casts.js", "dates.js", "queryPlan.js", "sqlGenerate.js", "project.js"].map(name => `src/core/${name}`);
const begin = "<!-- BEGIN GENERATED CANONICAL CORE -->";
const end = "<!-- END GENERATED CANONICAL CORE -->";
export function normalizeSourceText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
const hash = text => crypto.createHash("sha256").update(normalizeSourceText(text), "utf8").digest("hex");
function transform(source) {
  const aliases = [];
  const withoutImports = source.replace(/import\s*\{([\s\S]*?)\}\s*from\s+["'][^"']+["'];\s*/g, (_, names) => {
    names.split(",").forEach(name => { const match = name.trim().match(/^(\w+)\s+as\s+(\w+)$/); if (match) aliases.push(`const ${match[2]} = ${match[1]};`); });
    return "";
  });
  return `${aliases.join("\n")}${aliases.length ? "\n" : ""}${withoutImports}`
    .replace(/export\s+function\s+/g, "function ")
    .replace(/export\s+const\s+/g, "const ")
    .replace(/export\s*\{[^}]+\};?\s*/g, "");
}
export function buildEmbeddedBlock() {
  const sources = modules.map(file => ({ file, source: normalizeSourceText(fs.readFileSync(path.join(root, file), "utf8")) }));
  const manifest = { format: 1, modules: sources.map(item => ({ file: item.file, sha256: hash(item.source) })) };
  const payload = `(function(){\n${sources.map(item => `// ${item.file}\n${transform(item.source)}`).join("\n")}\nwindow.SQLBICanonicalCore = { buildQueryPlan, generateSql, normalizeVisualizationSettings, createProjectSnapshot, parseProjectSnapshot };\n})();\n`;
  manifest.payloadSha256 = hash(payload);
  return `${begin}\n/* Generated from canonical src/core modules. Do not edit manually. */\n/* SQLBI_CANONICAL_MANIFEST ${JSON.stringify(manifest)} */\n${payload}${end}`;
}
export function verify(html) {
  const starts = html.split(begin).length - 1, ends = html.split(end).length - 1;
  if (starts !== 1 || ends !== 1) throw new Error("generated markers must occur exactly once");
  const start = html.indexOf(begin), finish = html.indexOf(end);
  if (start >= finish) throw new Error("generated marker order is invalid");
  if (html.slice(start, finish).includes("import ")) throw new Error("embedded runtime contains import");
  if (normalizeSourceText(html.slice(start, finish + end.length)).trim() !== buildEmbeddedBlock().trim()) throw new Error("generated runtime is stale or manually modified");
  return true;
}
const mode = process.argv[2];
if (mode === "--write") {
  const html = fs.readFileSync(htmlPath, "utf8"), block = buildEmbeddedBlock();
  const withoutGeneratedBlock = html.replace(new RegExp(`${begin}[\\s\\S]*?${end}`), "");
  const anchor = withoutGeneratedBlock.indexOf("</script>");
  if (anchor < 0) throw new Error("portable bootstrap script not found");
  const beforeAnchor = withoutGeneratedBlock.slice(0, anchor).replace(/[ \t\r\n]+$/, "");
  const afterAnchor = withoutGeneratedBlock.slice(anchor).replace(/^<\/script>[ \t]*\r?\n[ \t]*\r?\n/, "</script>\n");
  const next = `${beforeAnchor}\n${block}\n${afterAnchor}`;
  if (next === html) console.log("already synchronized"); else { fs.writeFileSync(htmlPath, next, "utf8"); console.log("production core synchronized"); }
} else if (mode === "--check") { verify(fs.readFileSync(htmlPath, "utf8")); console.log("production core synchronized"); }
else if (process.argv[1].endsWith("sync-production-core.mjs")) throw new Error("use --write or --check");
