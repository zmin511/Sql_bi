import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { VERSION_RE, assertStaticReleaseContracts, assertVersion } from "../scripts/preflight-utils.mjs";
const root = process.cwd(); const dev = fs.readFileSync("scripts/check-local-development.mjs", "utf8"); const release = fs.readFileSync("scripts/check-local-release.mjs", "utf8");
const test = (name, fn) => { fn(); console.log(`ok - ${name}`); };
test("preflight scripts exist and parse", () => { assert.ok(fs.existsSync("scripts/check-local-development.mjs")); assert.ok(fs.existsSync("scripts/check-local-release.mjs")); execFileSync(process.execPath,["--check","scripts/check-local-development.mjs"]); execFileSync(process.execPath,["--check","scripts/check-local-release.mjs"]); });
test("scripts are read-only and local", () => { for (const source of [dev, release]) for (const forbidden of ["--write", "git push", "git commit", "git tag", "npm install"]) assert.equal(source.includes(forbidden), false); });
test("version contract accepts current version", () => assert.equal(VERSION_RE.test("0.2.2"), true));
test("missing and invalid versions fail closed", () => { assert.throws(() => assertVersion(root, "")); assert.throws(() => assertVersion(root, "bad")); });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-preflight-fixture-"));
try { for (const file of ["VERSION", "package.json", "index.html", "CHANGELOG.md"]) fs.copyFileSync(path.join(root,file),path.join(temp,file));
  test("version mismatch fails closed", () => assert.throws(() => assertVersion(temp, "0.2.3")));
  test("stale runtime and public API fail closed", () => { fs.appendFileSync(path.join(temp,"index.html"), "\nwindow.__SQLBI_TEST__ = {};\n"); assert.throws(() => assertStaticReleaseContracts(temp)); });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("6 local preflight tests passed");
