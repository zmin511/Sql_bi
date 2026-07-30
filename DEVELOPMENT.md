# Local-first development

Normal work stays on `local/next-development` and is validated locally:

```powershell
git switch local/next-development
npm run check:local
if ($LASTEXITCODE -ne 0) { throw "Local preflight failed." }
git add -- <explicit files>
npm run check:local
if ($LASTEXITCODE -ne 0) { throw "Staged local preflight failed." }
git commit -m "<message>"
```

Before a substantial milestone, create a local recovery point:

```powershell
git tag -a checkpoint/<name> -m "<description>"
git bundle create D:\Backups\SQL_BI\<name>.bundle --all
git bundle verify D:\Backups\SQL_BI\<name>.bundle
```

Before any future release run `npm run check:release -- <version>` and stop on a non-zero `$LASTEXITCODE`. Both preflights are read-only. If files are staged, they build an index tree with `git write-tree`, archive its Git blob bytes with command-scoped `core.autocrlf=false`, and validate that exact candidate. Unstaged changes in other tracked files are excluded from the archive; an unstaged change to a staged path is rejected fail-closed. The directory is removed in `finally`.

Push, remote tags, main merge and GitHub Release require separate authorization. Do not use `git add .`, `git add -A`, `git commit -a`, force-push, move a published tag, or manually edit the generated canonical block.
