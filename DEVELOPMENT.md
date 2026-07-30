# Local-first development

Normal work stays on `local/next-development` and is validated locally:

```powershell
git switch local/next-development
npm run check:local
git add -- <explicit files>
npm run check:local
git commit -m "<message>"
```

Before a substantial milestone, create a local recovery point:

```powershell
git tag -a checkpoint/<name> -m "<description>"
git bundle create D:\Backups\SQL_BI\<name>.bundle --all
git bundle verify D:\Backups\SQL_BI\<name>.bundle
```

Before any future release run `npm run check:release -- <version>`. Both preflights are read-only. If files are staged, they export the index into a system temporary directory, reject unstaged tracked differences, and validate that exact candidate; the directory is removed in `finally`.

Push, remote tags, main merge and GitHub Release require separate authorization. Do not use `git add .`, `git add -A`, `git commit -a`, force-push, move a published tag, or manually edit the generated canonical block.
