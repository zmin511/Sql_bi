import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION_RE = /^\d+\.\d+\.\d+$/;
export function fail(message) { throw new Error(`preflight failed: ${message}`); }
export function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}
export function runNpm(args, cwd) {
  if (process.platform === "win32") return run("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], cwd);
  return run("npm", args, cwd);
}
export function readVersion(root, file) { return fs.readFileSync(path.join(root, file), "utf8").trim(); }
export function assertVersion(root, expected) {
  if (!VERSION_RE.test(expected)) fail("expected version must be X.Y.Z");
  const version = readVersion(root, "VERSION");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  if (version !== expected || pkg !== expected || !html.includes(`SQL BI ${expected}`) || !html.includes(`v${expected}`)) fail("current version locations do not match expected version");
  const changelog = path.join(root, "CHANGELOG.md");
  if (fs.existsSync(changelog) && !fs.readFileSync(changelog, "utf8").match(new RegExp(`^## ${expected.replaceAll(".", "\\.")}\\b`, "m"))) fail("latest changelog version does not match expected version");
}
export function assertStaticReleaseContracts(root) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  if (/window\.__SQLBI_TEST__\s*=/.test(html)) fail("raw HTML exposes public test API");
  if (/<script\b[^>]*\bsrc\s*=/.test(html) || /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(html)) fail("production HTML has external runtime assets");
  if (/function\s+renderSQL\s*\([^)]*\)\s*\{[\s\S]*?generateSql/.test(html)) fail("legacy manual SQL renderer signature found");
  if (fs.existsSync(path.join(root, "package-lock.json"))) fail("package-lock.json must not exist");
}
export function stagedFiles(root) { return execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean); }
export function withCandidate(root, callback) {
  const staged = stagedFiles(root);
  if (!staged.length) return callback(root, { staged: false, files: [] });
  const unstaged = execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" }).trim();
  if (unstaged) fail("staged candidate has unstaged tracked changes");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-preflight-"));
  const archive = path.join(os.tmpdir(), `sql-bi-preflight-${process.pid}-${Date.now()}.tar`);
  try {
    const treeId = execFileSync("git", ["write-tree"], { cwd: root, encoding: "utf8" }).trim();
    const bytes = execFileSync("git", ["archive", "--format=tar", treeId], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(archive, bytes);
    run("tar", ["-xf", archive, "-C", temp], root);
    return callback(temp, { staged: true, files: staged });
  } finally { fs.rmSync(archive, { force: true }); fs.rmSync(temp, { recursive: true, force: true }); }
}
export function checkCore(root, { release = false } = {}) {
  run(process.execPath, ["scripts/sync-production-core.mjs", "--check"], root);
  run(process.execPath, ["--check", "scripts/sync-production-core.mjs"], root);
  run(process.execPath, ["--check", "scripts/check-portable.mjs"], root);
  run(process.execPath, ["tests/production-core-embed.test.js"], root);
  if (release) assertStaticReleaseContracts(root);
  runNpm(["test"], root);
  runNpm(["run", "check:portable"], root);
}
