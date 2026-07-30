# SQL BI — CURRENT LOCAL HANDOFF

## 1. Project

SQL BI is a portable, local-first browser application for importing 1C metadata structures, selecting physical and synthetic fields, generating SQL through a canonical query plan, inspecting relationships and projected fields, and saving/loading project snapshots.

The published version remains `0.2.2`. Local development after that release is intentionally unpublished.

## 2. Working directory

Use only:

```text
D:\Projects\SQL_BI
```

Do not use the obsolete path:

```text
D:\Work\Codex\SQL_BI
```

Environment: Windows PowerShell. Set `$ErrorActionPreference = "Stop"` and check `$LASTEXITCODE` after native commands.

## 3. Current branch and HEAD

Branch:

```text
local/next-development
```

HEAD before the LOCAL09 documentation commit:

```text
abe96539bfb7763ebbb0f4726768fad591850d97
```

Commit:

```text
Consolidate project persistence in canonical core
```

The LOCAL09 documentation commit is expected to be the direct child of this commit.

The branch has no upstream.

## 4. Remote state

Remote operations have intentionally not been performed during the local-first milestones. These values are locally known tracking refs and must not be represented as freshly verified GitHub state:

```text
origin/main = f7d7fa5fbbe0679442d40dd82d4036efce401432
origin/refactor/step02-production-parity = 63de5b2c46ab5c619eadcf3393602dd5d578a0b7
```

Do not fetch or push without a separate explicit decision.

## 5. Published release history

The published release is `v0.2.2`. Its tag identifies a stale published artifact and is immutable: do not move, recreate, or delete it.

The local branch contains later repairs and development commits that have not been published. The application version remains `0.2.2`; no new release has been created.

## 6. Local-first workflow

Development, verification, checkpoint tags, bundles, and commits occur locally. Publication is a separate authorized step.

Normal workflow:

1. Verify branch, HEAD, empty staging, and clean tracked tree.
2. Do not enumerate or inspect user untracked files.
3. Make only explicitly scoped changes.
4. Run targeted tests, full regression, portable checks, and working preflight.
5. Stage explicit files only.
6. Run exact staged-candidate preflight.
7. Create a local commit.
8. Do not push without separate permission.

## 7. Local commits after v0.2.2

```text
3cbc476aed2b51c5c4deef366d18571532fa9d65 — Repair embedded canonical runtime
a556392ecb554ad9a4b5ff8db3677482b6e7af80 — Add local-first preflight workflow
cabfc3d54be24c760e3917d2f1bff524a598faf1 — Fix staged preflight export
b449222f6f02ca5e0489a1d245a42e0666e08403 — Normalize embedded runtime generation across Git EOL
843c79266b4bb95eb66d9cd32354d6a8cb5103f4 — Add safe project load diagnostics
0883e5fa4f76cd84c4e129d83c7d47560b1e426c — Add projected fields query plan inspection
e1b4064f503142c57c15413d17a87c442a0c2b51 — Fix project filters and staged candidate handling
abe96539bfb7763ebbb0f4726768fad591850d97 — Consolidate project persistence in canonical core
```

## 8. Current architecture

- Canonical SQL, relationship, selection, reference, query-plan, and project-persistence behavior lives in `src/core`.
- Production is a portable `index.html` containing an embedded generated canonical runtime.
- Production SQL generation consumes the embedded canonical query-plan API.
- Production project load/save consumes the embedded canonical project API.
- UI code owns file interaction, application of normalized state, DOM rendering, and user-facing messages.
- Derived query plans, query results, graph state, and load diagnostics are not trusted project input and are not serialized.

## 9. Canonical embedded runtime

`scripts/sync-production-core.mjs` generates the canonical block in `index.html`.

Never edit the generated block manually. Use:

```powershell
node scripts/sync-production-core.mjs --write
node scripts/sync-production-core.mjs --check
```

Byte contract:

- source is UTF-8;
- BOM is removed;
- CRLF and CR are normalized to LF;
- source and payload hashes use normalized text;
- generation is deterministic and idempotent.

The embedded namespace exports query-plan, SQL, visualization-normalization, and project parse/build APIs.

## 10. Local preflight workflow

Working and staged-candidate checks use:

```powershell
npm run check:local
npm run check:release -- 0.2.2
```

When staging is empty, the scripts validate the working-state contract. When staging is non-empty, they validate the exact candidate represented by `HEAD tree + staged index changes`.

The candidate is created through `git write-tree` and `git archive`. Archive creation uses command-scoped `core.autocrlf=false`, so Git blobs remain byte-faithful. Unstaged changes are excluded; overlapping staged/unstaged changes to the same candidate path fail closed. The scripts are fail-fast, guard native exit codes, clean temporary directories, preserve index/working tree state, and perform no remote operations.

## 11. Project persistence

Canonical project persistence is implemented in `src/core/project.js`:

- `parseProjectSnapshot`;
- `createProjectSnapshot`;
- `normalizeVisualizationSettings`.

Production delegates load, save, diagnostics, stale-reference filtering, synthetic selection/filter handling, and visualization normalization to this API. The duplicate production parser and serializer were removed.

Format remains `1`. Existing project files remain compatible. Valid physical and retained synthetic boolean filters survive; stale filters and selections are dropped fail-closed. Canonical `loadDiagnostics` reach the UI but are never serialized.

## 12. Query plan and projected fields

The canonical query plan owns normalized selections, aliases, SQL expressions, joins, filters, status, and diagnostic reasons.

Projected-fields inspection renders `plan.selections` directly. Production does not rebuild projection aliases or expressions. Synthetic reference fields expose their resolved physical source and chain. Blocked selections retain canonical reasons without partial SQL.

## 13. Production UI

The UI supports structure import, tree/reference navigation, selections and filters, canonical SQL generation, relationship graph presentation, projected-fields inspection, project save/load, and Power Query export.

Production state stores canonical `queryPlan` and `queryResult` only as derived runtime state. Project load applies canonical normalized state and refreshes the DOM. Recovery messages format canonical diagnostics.

Test hooks are VM-only instrumentation added to an in-memory application-script copy. Raw `index.html` does not publish `window.__SQLBI_TEST__`, and an uninstrumented runtime exposes no hooks.

## 14. Test suites

`npm test` currently runs 24 suite commands.

Important counts:

```text
portable checks: 5
project persistence parity: 10
projected fields inspection: 14
local preflight: 10
production core embed: 30
production UI characterization: 40
query plan: 40
production query-plan parity: 20
```

Reference resolution/chain/SQL, selection context, table-part relationship, identifiers, numeric, date, production visualization, project diagnostics, and integration suites are also included and passing.

## 15. Current verification status

Final LOCAL09 verification on `abe96539bfb7763ebbb0f4726768fad591850d97`:

```text
node scripts/sync-production-core.mjs --check — PASS
npm test — PASS
npm run check:portable — PASS (5/5)
npm run check:local — PASS
npm run check:release -- 0.2.2 — PASS
git diff --check — PASS
```

No CRITICAL, HIGH, or MEDIUM finding is confirmed after LOCAL08.

## 16. Backup and checkpoint locations

Principal local checkpoints:

```text
checkpoint/local-release-candidate-1
checkpoint/before-local07-stabilization
checkpoint/before-local08-project-consolidation
checkpoint/end-of-codex-session-2026-07-30
```

Principal bundles:

```text
D:\Backups\SQL_BI\SQL_BI_before_LOCAL07_2026-07-30.bundle
D:\Backups\SQL_BI\SQL_BI_before_LOCAL08_2026-07-30.bundle
D:\Backups\SQL_BI\SQL_BI_end_of_session_2026-07-30.bundle
```

Final bundle:

```text
path: D:\Backups\SQL_BI\SQL_BI_end_of_session_2026-07-30.bundle
size: 1755079 bytes
verification: PASS; complete history
checkpoint target: abe96539bfb7763ebbb0f4726768fad591850d97
```

These tags and bundles are local and have not been pushed.

## 17. Important Git rules

```text
Do not use git add .
Do not use git add -A.
Do not use git commit -a.
Do not push without separate explicit permission.
Do not move or delete published v0.2.2.
Do not manually edit the generated canonical block.
Do not use reset, restore, checkout, stash, or clean to discard user work.
```

Use explicit path staging and review the complete cached diff before committing.

## 18. Protected files and constraints

Do not change `VERSION`, `CHANGELOG.md`, `README.md`, `package-lock.json`, production UI, canonical behavior, test architecture, release metadata, or preflight scripts without a separately scoped and evidenced milestone.

Do not enumerate, open, modify, stage, or delete user untracked files.

Keep version `0.2.2` until an explicitly authorized release milestone.

## 19. Known backlog

- No CRITICAL, HIGH, or MEDIUM findings are confirmed after LOCAL08.
- Begin the next milestone with a small read-only gap audit.
- Do not begin a broad architecture migration without a demonstrated functional gap.
- LOW/INFO cleanup is intentionally deferred and must not be inferred as authorization for refactoring.

## 20. Recommended next milestone

Perform a bounded read-only functional gap audit of the current local candidate. Rank concrete user-visible gaps, select one highest-value milestone, and require reproduction or contract evidence before changing production behavior.

Do not publish the branch as part of that audit.

## 21. Mandatory precheck for next session

Run from `D:\Projects\SQL_BI`:

```powershell
$ErrorActionPreference = "Stop"
$env:GIT_PAGER = "cat"
$env:PAGER = "cat"

git branch --show-current
if ($LASTEXITCODE -ne 0) { throw "Branch check failed." }

git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "HEAD check failed." }

git rev-parse HEAD^
if ($LASTEXITCODE -ne 0) { throw "Parent check failed." }

git --no-pager status --short --untracked-files=no
if ($LASTEXITCODE -ne 0) { throw "Tracked status check failed." }

git --no-pager diff --cached --name-only
if ($LASTEXITCODE -ne 0) { throw "Staging check failed." }

git --no-pager diff --name-only
if ($LASTEXITCODE -ne 0) { throw "Working diff check failed." }

git branch -vv
if ($LASTEXITCODE -ne 0) { throw "Branch tracking check failed." }

node scripts/sync-production-core.mjs --check
if ($LASTEXITCODE -ne 0) { throw "Embedded runtime sync failed." }

npm test
if ($LASTEXITCODE -ne 0) { throw "Baseline regression failed." }

npm run check:portable
if ($LASTEXITCODE -ne 0) { throw "Portable checks failed." }

npm run check:local
if ($LASTEXITCODE -ne 0) { throw "Local preflight failed." }

npm run check:release -- 0.2.2
if ($LASTEXITCODE -ne 0) { throw "Release preflight failed." }
```

Expected after LOCAL09:

- branch `local/next-development`;
- HEAD is the documentation commit whose parent is `abe96539bfb7763ebbb0f4726768fad591850d97`;
- staging is empty;
- tracked tree is clean;
- upstream is absent;
- remote state has not been freshly verified;
- version is `0.2.2`;
- `package-lock.json` is absent.
