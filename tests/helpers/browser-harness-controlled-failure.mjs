import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-controlled-failure-"));
const marker = path.join(profile, ".owned-by-browser-harness-self-test");
fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, schema: 1 }));
const server = http.createServer((_request, response) => response.end("owned"));
const ownedProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
let port = null;
let errorMessage = "";

try {
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  port = server.address().port;
  throw new Error("controlled browser harness failure");
} catch (error) {
  errorMessage = error.message;
  process.exitCode = 23;
} finally {
  await new Promise(resolve => server.close(resolve));
  if (ownedProcess.exitCode === null) {
    ownedProcess.kill();
    await Promise.race([new Promise(resolve => ownedProcess.once("exit", resolve)), delay(2000)]);
  }
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  process.stdout.write(`${JSON.stringify({ profile, port, ownedPid: ownedProcess.pid, errorMessage, profileRemoved: !fs.existsSync(profile), serverClosed: !server.listening })}\n`);
}
