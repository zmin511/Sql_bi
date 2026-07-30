import { checkCore, run, withCandidate } from "./preflight-utils.mjs";
async function main() { const cwd = process.cwd(); withCandidate(cwd, root => checkCore(root)); run("git", ["diff", "--check"], cwd); console.log("local development preflight passed"); }
main().catch(error => { console.error(error.message); process.exit(1); });
