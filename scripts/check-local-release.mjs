import { assertStaticReleaseContracts, assertVersion, checkCore, fail, run, withCandidate } from "./preflight-utils.mjs";
const version = process.argv[2];
try {
  if (!version) fail("expected version argument is required");
  const cwd = process.cwd(); withCandidate(cwd, root => { assertVersion(root, version); assertStaticReleaseContracts(root); checkCore(root, { release: true }); }); run("git", ["diff", "--check"], cwd);
  console.log(`local release preflight passed for ${version}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
