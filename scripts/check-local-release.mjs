import { assertStaticReleaseContracts, assertVersion, checkCore, fail, run, withCandidate } from "./preflight-utils.mjs";
const version = process.argv[2];
async function main() {
  if (!version) fail("expected version argument is required");
  const cwd = process.cwd(); withCandidate(cwd, root => { assertVersion(root, version); assertStaticReleaseContracts(root); checkCore(root, { release: true }); }); run("git", ["diff", "--check"], cwd);
  console.log(`local release preflight passed for ${version}`);
}
main().catch(error => { console.error(error.message); process.exit(1); });
