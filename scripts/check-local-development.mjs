import { checkCore, run, withCandidate } from "./preflight-utils.mjs";
try { const cwd = process.cwd(); withCandidate(cwd, root => checkCore(root)); run("git", ["diff", "--check"], cwd); console.log("local development preflight passed"); } catch (error) { console.error(error.message); process.exitCode = 1; }
