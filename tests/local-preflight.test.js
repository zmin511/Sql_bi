import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { VERSION_RE, assertProductionExportVersion, assertStaticReleaseContracts, assertVersion, withCandidate } from "../scripts/preflight-utils.mjs";
const root = process.cwd(); const dev = fs.readFileSync("scripts/check-local-development.mjs", "utf8"); const release = fs.readFileSync("scripts/check-local-release.mjs", "utf8");
const test = (name, fn) => { fn(); console.log(`ok - ${name}`); };
test("preflight scripts exist and parse", () => { assert.ok(fs.existsSync("scripts/check-local-development.mjs")); assert.ok(fs.existsSync("scripts/check-local-release.mjs")); execFileSync(process.execPath,["--check","scripts/check-local-development.mjs"]); execFileSync(process.execPath,["--check","scripts/check-local-release.mjs"]); });
test("scripts are read-only and local", () => { for (const source of [dev, release]) for (const forbidden of ["--write", "git push", "git commit", "git tag", "npm install"]) assert.equal(source.includes(forbidden), false); });
test("version contract accepts current version", () => assert.equal(VERSION_RE.test("0.2.2"), true));
test("missing and invalid versions fail closed", () => { assert.throws(() => assertVersion(root, "")); assert.throws(() => assertVersion(root, "bad")); });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-preflight-fixture-"));
try { for (const file of ["VERSION", "package.json", "index.html", "CHANGELOG.md"]) fs.copyFileSync(path.join(root,file),path.join(temp,file));
  test("version mismatch fails closed", () => assert.throws(() => assertVersion(temp, "0.2.3")));
  test("stale production export version fails closed", () => { fs.writeFileSync(path.join(temp,"index.html"), fs.readFileSync(path.join(temp,"index.html"),"utf8").replace('const APP_VERSION = "0.2.4";', 'const APP_VERSION = "0.2.3";')); assert.throws(() => assertProductionExportVersion(temp, "0.2.4"), /APP_VERSION/); });
  test("stale runtime and public API fail closed", () => { fs.appendFileSync(path.join(temp,"index.html"), "\nwindow.__SQLBI_TEST__ = {};\n"); assert.throws(() => assertStaticReleaseContracts(temp)); });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

const candidateRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-candidate-fixture-"));
try {
  const git = args => execFileSync("git", args, { cwd: candidateRepo, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(candidateRepo, "a.txt"), "HEAD A\n");
  fs.writeFileSync(path.join(candidateRepo, "b.txt"), "HEAD B\n");
  git(["init", "-q"]);
  git(["config", "user.name", "SQL BI Test"]);
  git(["config", "user.email", "sql-bi-test@example.invalid"]);
  git(["add", "--", "a.txt", "b.txt"]);
  git(["commit", "-q", "-m", "fixture"]);
  fs.writeFileSync(path.join(candidateRepo, "a.txt"), "STAGED A\n");
  git(["add", "--", "a.txt"]);
  fs.writeFileSync(path.join(candidateRepo, "b.txt"), "UNSTAGED B\n");
  const indexBefore = git(["diff", "--cached", "--binary"]);
  const workingBefore = git(["diff", "--binary"]);
  const stagedA = execFileSync("git", ["show", ":a.txt"], { cwd: candidateRepo });
  const headB = execFileSync("git", ["show", "HEAD:b.txt"], { cwd: candidateRepo });
  const tempBefore = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("sql-bi-preflight-")).sort();
  test("candidate includes staged A and excludes unstaged B", () => {
    withCandidate(candidateRepo, candidate => {
      assert.deepEqual(fs.readFileSync(path.join(candidate, "a.txt")), stagedA);
      assert.deepEqual(fs.readFileSync(path.join(candidate, "b.txt")), headB);
    });
    assert.equal(git(["diff", "--cached", "--binary"]), indexBefore);
    assert.equal(git(["diff", "--binary"]), workingBefore);
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("sql-bi-preflight-")).sort(), tempBefore);
  });
  test("candidate rejects staged and unstaged changes to the same path", () => {
    fs.writeFileSync(path.join(candidateRepo, "a.txt"), "UNSTAGED A\n");
    assert.throws(() => withCandidate(candidateRepo, () => {}), /unstaged changes in staged files: a\.txt/);
  });
} finally { fs.rmSync(candidateRepo, { recursive: true, force: true }); }

const artifactRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-artifact-fixture-"));
try {
  const git = args => execFileSync("git", args, { cwd: artifactRepo, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(artifactRepo, "index.html"), "<script>const runtime = true;</script>\n");
  git(["init", "-q"]);
  git(["config", "user.name", "SQL BI Test"]);
  git(["config", "user.email", "sql-bi-test@example.invalid"]);
  git(["add", "--", "index.html"]);
  git(["commit", "-q", "-m", "fixture"]);
  fs.writeFileSync(path.join(artifactRepo, "index.html"), "<script>const runtime = 'valid';</script>\n");
  git(["add", "--", "index.html"]);
  test("valid staged artifact passes candidate validation", () => {
    withCandidate(artifactRepo, candidate => assertStaticReleaseContracts(candidate));
  });
  fs.writeFileSync(path.join(artifactRepo, "index.html"), "<script>window.__SQLBI_TEST__ = {};</script>\n");
  git(["add", "--", "index.html"]);
  test("stale staged artifact remains fail-closed", () => {
    assert.throws(() => withCandidate(artifactRepo, candidate => assertStaticReleaseContracts(candidate)), /public test API/);
  });
} finally { fs.rmSync(artifactRepo, { recursive: true, force: true }); }
console.log("10 local preflight tests passed");
