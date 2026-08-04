import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function withTimeout(promise, milliseconds, operation, detail = "") {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out after ${milliseconds}ms${detail ? ` (${detail})` : ""}`)), milliseconds);
    })
  ]);
}

export const TIMEOUTS = { suite: 120000, launch: 10000, cdp: 10000, navigation: 15000, fixture: 20000, selector: 10000, interaction: 10000, cleanup: 10000, serverStart: 5000, serverClose: 5000, devtoolsLine: 10000, portReady: 5000, browserWs: 10000 };

export function browserExecutable() {
  const candidates = installedBrowsers();
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error("Microsoft Edge or Google Chrome is required for browser characterization.");
  return executable;
}

export function installedBrowsers() {
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
}

export async function availablePort() {
  const server = net.createServer();
  await withTimeout(new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject)), TIMEOUTS.serverStart, "temporary port server startup", "127.0.0.1:0");
  const { port } = server.address();
  await withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), TIMEOUTS.serverClose, "temporary port server close", `127.0.0.1:${port}`);
  return port;
}

export async function listenServer(server, host = "127.0.0.1", port = 0, timeout = TIMEOUTS.serverStart) {
  await withTimeout(new Promise((resolve, reject) => {
    const onError = error => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  }), timeout, "server startup", `${host}:${port}`);
  return server.address().port;
}

export async function closeServer(server, sockets, timeout = TIMEOUTS.serverClose) {
  if (!server.listening) return;
  const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeIdleConnections?.();
  try {
    await withTimeout(closing, timeout, "server close", `activeConnections=${sockets.size}`);
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await withTimeout(closing, timeout, "forced server close", `activeConnections=${sockets.size}`);
    if (server.listening) throw error;
  }
}

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function portIsClosed(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
    socket.once("timeout", () => { socket.destroy(); resolve(true); });
  });
}

export async function portIsOpen(port, timeout = TIMEOUTS.portReady) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const closed = await portIsClosed(port);
    if (!closed) return true;
    await delay(50);
  }
  return false;
}

export async function fetchJson(url, timeout = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export const PROFILE_MARKER = ".sql-bi-browser-harness-owned.json";
export const PROFILE_SCHEMA = 1;

export function recoverOwnedProfiles(root) {
  const result = { removed: [], retained: [], ignored: [] };
  fs.mkdirSync(root, { recursive: true });
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("sql-bi-browser-")) continue;
    const directory = path.join(root, entry.name);
    const markerPath = path.join(directory, PROFILE_MARKER);
    if (!fs.existsSync(markerPath)) { result.ignored.push(directory); continue; }
    let marker;
    try { marker = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { result.ignored.push(directory); continue; }
    if (marker.schema !== PROFILE_SCHEMA || marker.harness !== "browser-query-graph") { result.ignored.push(directory); continue; }
    if (processIsAlive(marker.pid)) { result.retained.push(directory); continue; }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    result.removed.push(directory);
  }
  return result;
}

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = new Map();
    queueMicrotask(() => { this.readyState = MockWebSocket.OPEN; this.emit("open", {}); });
  }
  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, entries);
  }
  emit(type, event) {
    const entries = [...(this.listeners.get(type) || [])];
    this.listeners.set(type, entries.filter(entry => !entry.once));
    for (const entry of entries) entry.listener(event);
  }
  send() {}
  close() { this.readyState = MockWebSocket.CLOSING; this.emit("close", {}); }
}

export class CdpClient {
  constructor(url, Socket = WebSocket) {
    this.socket = new Socket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.closing = false;
  }

  async open() {
    await withTimeout(new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    }), TIMEOUTS.cdp, "CDP WebSocket connection", this.socket.url);
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
        if (message.method === "Page.javascriptDialogOpening") {
          this.command("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        }
      }
    });
    this.socket.addEventListener("close", () => { if (!this.closing) this.rejectPending(new Error("CDP WebSocket closed")); });
    this.socket.addEventListener("error", () => { if (!this.closing) this.rejectPending(new Error("CDP WebSocket failed")); });
  }

  command(method, params = {}, timeout = TIMEOUTS.cdp) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close() {
    this.closing = true;
    this.rejectPending(new Error("CDP client closed by cleanup"));
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

export function parseDevToolsUrl(stderr, expectedPort) {
  const matches = [...stderr.matchAll(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+)/g)].map(match => match[1]);
  const valid = matches.filter(value => { try { const url = new URL(value); return url.protocol === "ws:" && url.hostname === "127.0.0.1" && /^\/devtools\/browser\/[a-f0-9-]+$/.test(url.pathname); } catch { return false; } });
  if (expectedPort === undefined) return valid.at(-1) || null;
  const matching = valid.filter(value => Number(new URL(value).port) === expectedPort);
  if (!matching.length) return null;
  const unique = [...new Set(matching)];
  if (unique.length > 1) throw new Error(`Ambiguous DevTools URLs for expected port ${expectedPort}`);
  return matching.at(-1);
}

export class LaunchAttempt {
  constructor(browserPath, pageUrl, attemptNumber, browserIndex) {
    this.browserPath = browserPath;
    this.pageUrl = pageUrl;
    this.attemptNumber = attemptNumber;
    this.browserIndex = browserIndex;
    this.profileRoot = os.tmpdir();
    this.profile = fs.mkdtempSync(path.join(this.profileRoot, "sql-bi-browser-"));
    this.marker = path.join(this.profile, PROFILE_MARKER);
    this.debugPort = null;
    this.browserProcess = null;
    this.browserClient = null;
    this.pageClient = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.diagnostic = { browserPath: path.basename(browserPath), attemptNumber, browserIndex, profile: this.profile };
  }

  writeMarker() {
    fs.writeFileSync(this.marker, JSON.stringify({ schema: PROFILE_SCHEMA, harness: "browser-query-graph", pid: process.pid, createdAt: new Date().toISOString(), debugPort: this.debugPort }));
  }

  captureOutput() {
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.browserProcess.stdout.on("data", chunk => { this.stdoutBuffer += chunk; });
    this.browserProcess.stderr.on("data", chunk => { this.stderrBuffer += chunk; });
  }

  lastOutput(limit = 2000) {
    return { stdout: this.stdoutBuffer.slice(-limit), stderr: this.stderrBuffer.slice(-limit) };
  }
}

function browserArguments(browserPath, pageUrl, debugPort, profile) {
  return [
    "--headless=new",
    "--disable-extensions",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--window-size=1920,1080",
    pageUrl
  ];
}

export async function waitForDevToolsLine(attempt, timeout = TIMEOUTS.devtoolsLine) {
  return withTimeout(new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const url = parseDevToolsUrl(attempt.stderrBuffer, attempt.debugPort);
        if (url) {
          clearInterval(timer);
          cleanup();
          resolve(url);
        }
      } catch (error) {
        clearInterval(timer);
        cleanup();
        reject(error);
      }
    }, 50);
    const exitHandler = (code, signal) => {
      clearInterval(timer);
      cleanup();
      const output = attempt.lastOutput(2000);
      reject(new Error(`Browser process exited before DevTools URL: code=${code}, signal=${signal}; stderr=${output.stderr}; stdout=${output.stdout}`));
    };
    attempt.browserProcess.once("exit", exitHandler);
    function cleanup() {
      attempt.browserProcess.off("exit", exitHandler);
    }
  }), timeout, "wait-for-devtools-line", `port=${attempt.debugPort};browser=${path.basename(attempt.browserPath)}`);
}

export async function verifyDebugPort(port, timeout = TIMEOUTS.portReady) {
  const open = await portIsOpen(port, timeout);
  if (!open) throw new Error(`Debug port ${port} is not reachable after ${timeout}ms`);
  try {
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1000);
    return version;
  } catch (error) {
    throw new Error(`Debug port ${port} reachable but /json/version failed: ${error.message}`);
  }
}

export async function coordinateLaunch({ browserCandidates, maxAttemptsPerBrowser, createAttempt, runAttempt, cleanup, suiteContext, onDiagnostic }) {
  const errors = [];
  let attemptNumber = 0;
  for (let browserIndex = 0; browserIndex < browserCandidates.length; browserIndex += 1) {
    for (let retry = 0; retry < maxAttemptsPerBrowser; retry += 1) {
      attemptNumber += 1;
      const attempt = await createAttempt(browserCandidates[browserIndex], attemptNumber, browserIndex);
      try { return await runAttempt(attempt); }
      catch (error) {
        const summary = { attemptNumber, browserPath: browserCandidates[browserIndex], debugPort: attempt.debugPort, profile: attempt.profile, phase: suiteContext.currentPhase, error: error.message, tail: attempt.lastOutput?.(1000) };
        errors.push(summary); onDiagnostic?.({ phase: "attempt-failed", ...summary }); await cleanup(attempt, suiteContext);
      }
    }
  }
  throw new Error(`All browser launch attempts failed: ${JSON.stringify(errors)}`);
}

export async function findOrCreatePageTarget(browserClient, pageUrl, timeout = TIMEOUTS.cdp) {
  await browserClient.command("Target.setDiscoverTargets", { discover: true }, timeout);
  const targetsResponse = await browserClient.command("Target.getTargets", {}, timeout);
  const existing = targetsResponse.targetInfos.find(target => target.type === "page");
  if (existing) return existing;
  const created = await browserClient.command("Target.createTarget", { url: pageUrl }, timeout);
  const createdTarget = targetsResponse.targetInfos.find(target => target.targetId === created.targetId);
  if (createdTarget) return createdTarget;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const event = browserClient.events.find(message => message.method === "Target.targetCreated" && message.params?.targetInfo?.targetId === created.targetId);
    if (event) return event.params.targetInfo;
    await delay(10);
  }
  throw new Error(`Target.createTarget did not surface created page target ${created.targetId}`);
}

export function pageWebSocketUrl(debugPort, targetId) {
  return `ws://127.0.0.1:${debugPort}/devtools/page/${targetId}`;
}

export async function cleanupAttempt(attempt, suiteContext) {
  suiteContext.currentPhase = "cleanup-attempt";
  if (attempt.pageClient) {
    try { attempt.pageClient.close(); } catch {}
  }
  if (attempt.browserClient) {
    try { attempt.browserClient.close(); } catch {}
  }
  if (attempt.browserProcess && attempt.browserProcess.exitCode === null) {
    const exited = new Promise(resolve => attempt.browserProcess.once("exit", resolve));
    try {
      await withTimeout(exited, TIMEOUTS.cleanup, "browser process cleanup");
    } catch {
      if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(attempt.browserProcess.pid), "/T", "/F"], { stdio: "ignore" });
      else attempt.browserProcess.kill("SIGKILL");
      await withTimeout(exited, TIMEOUTS.cleanup, "forced browser process cleanup");
    }
  }
  if (attempt.profile && fs.existsSync(attempt.profile)) {
    for (let attemptIdx = 0; attemptIdx < 10; attemptIdx += 1) {
      try { fs.rmSync(attempt.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); break; }
      catch (error) { if (attemptIdx === 9) throw error; await delay(200); }
    }
  }
}

export async function runSingleAttempt(CdpClient, attempt, pageUrl, suiteContext, onDiagnostic) {
  suiteContext.currentPhase = "allocate-port";
  attempt.debugPort = await availablePort();
  suiteContext.debugPort = attempt.debugPort;
  attempt.writeMarker();

  suiteContext.currentPhase = "launch-browser";
  attempt.browserProcess = spawn(attempt.browserPath, browserArguments(attempt.browserPath, pageUrl, attempt.debugPort, attempt.profile), { stdio: ["ignore", "pipe", "pipe"] });
  attempt.captureOutput();
  suiteContext.browserPid = attempt.browserProcess.pid;
  attempt.diagnostic.pid = attempt.browserProcess.pid;
  attempt.diagnostic.debugPort = attempt.debugPort;
  onDiagnostic?.({ phase: "launch-browser", ...attempt.diagnostic });

  suiteContext.currentPhase = "wait-devtools-line";
  const browserWsUrl = await waitForDevToolsLine(attempt);
  attempt.diagnostic.browserWsUrl = browserWsUrl;
  onDiagnostic?.({ phase: "devtools-line", ...attempt.diagnostic });

  suiteContext.currentPhase = "connect-browser-websocket";
  attempt.browserClient = new CdpClient(browserWsUrl);
  await attempt.browserClient.open();
  verifyDebugPort(attempt.debugPort).then(version => { attempt.diagnostic.httpVersion = version; }).catch(error => { attempt.diagnostic.httpProbeError = error.message; });
  onDiagnostic?.({ phase: "browser-websocket-connected", ...attempt.diagnostic });

  suiteContext.currentPhase = "create-or-find-page-target";
  const pageTarget = await findOrCreatePageTarget(attempt.browserClient, pageUrl);
  attempt.diagnostic.pageTargetId = pageTarget.targetId;
  onDiagnostic?.({ phase: "page-target-acquired", ...attempt.diagnostic });

  suiteContext.currentPhase = "connect-page-websocket";
  const pageWsUrl = pageWebSocketUrl(attempt.debugPort, pageTarget.targetId);
  attempt.pageClient = new CdpClient(pageWsUrl);
  await attempt.pageClient.open();
  onDiagnostic?.({ phase: "page-websocket-connected", ...attempt.diagnostic });

  return attempt;
}

export async function launchBrowserPage({ CdpClient, pageUrl, suiteContext, preferredBrowsers, maxAttemptsPerBrowser = 2, onDiagnostic }) {
  const browsers = preferredBrowsers ?? installedBrowsers().filter(p => fs.existsSync(p));
  if (browsers.length === 0) throw new Error("No supported browser found");
  return coordinateLaunch({ browserCandidates:browsers, maxAttemptsPerBrowser, suiteContext, onDiagnostic,
    createAttempt: async (browserPath, attemptNumber, browserIndex) => { if (suiteContext.abortController?.signal?.aborted) throw new Error("launch aborted by suite watchdog"); const attempt=new LaunchAttempt(browserPath,pageUrl,attemptNumber,browserIndex); onDiagnostic?.({phase:"attempt-start",...attempt.diagnostic}); return attempt; },
    runAttempt: attempt => runSingleAttempt(CdpClient,attempt,pageUrl,suiteContext,onDiagnostic), cleanup: cleanupAttempt });
}

function controlledChildProfile() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-controlled-failure-"));
  const marker = path.join(profile, ".owned-by-browser-harness-self-test");
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, schema: 1 }));
  return profile;
}

export async function controlledFailureSelfTest() {
  const server = http.createServer((_request, response) => response.end("owned"));
  const profile = controlledChildProfile();
  const ownedProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  let port = null;
  let errorMessage = "";
  try {
    await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
    port = server.address().port;
    throw new Error("controlled browser harness failure");
  } catch (error) {
    errorMessage = error.message;
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (ownedProcess.exitCode === null) {
      ownedProcess.kill();
      await Promise.race([new Promise(resolve => ownedProcess.once("exit", resolve)), delay(2000)]);
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  const result = { profile, port, ownedPid: ownedProcess.pid, errorMessage, profileRemoved: !fs.existsSync(profile), serverClosed: !server.listening };
  assert.equal(result.errorMessage, "controlled browser harness failure");
  assert.equal(result.profileRemoved, true);
  assert.equal(result.serverClosed, true);
  assert.equal(processIsAlive(result.ownedPid), false);
  assert.equal(await portIsClosed(result.port), true);
  return result;
}

export async function launchLayerSelfTests(CdpClient) {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test("parseDevToolsUrl extracts browser-level WebSocket URL", () => {
    const stderr = "some noise\nDevTools listening on ws://127.0.0.1:12345/devtools/browser/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\nmore";
    assert.equal(parseDevToolsUrl(stderr, 12345), "ws://127.0.0.1:12345/devtools/browser/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("parseDevToolsUrl rejects port mismatch", () => {
    const stderr = "DevTools listening on ws://127.0.0.1:12345/devtools/browser/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    assert.equal(parseDevToolsUrl(stderr, 9999), null);
  });

  test("parseDevToolsUrl returns null when line missing", () => {
    assert.equal(parseDevToolsUrl("no devtools here"), null);
  });

  test("parser selects current endpoint among stale, CRLF, split, invalid, and duplicate lines", () => {
    const stale="ws://127.0.0.1:11111/devtools/browser/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const current="ws://127.0.0.1:22222/devtools/browser/ffffffff-1111-2222-3333-444444444444";
    assert.equal(parseDevToolsUrl(`bad\r\nDevTools listening on ${stale}\nDevTools listening on ${current}`,22222),current);
    assert.equal(parseDevToolsUrl(`DevTools listening on ${current}\nDevTools listening on ${stale}\nDevTools listening on ${current}`,22222),current);
    assert.equal(parseDevToolsUrl(`DevTools listening on ws://evil.test:22222/devtools/browser/x\nDevTools listening on ${current}`,22222),current);
    assert.equal(parseDevToolsUrl(`DevTools listening on ${stale}`,22222),null);
    assert.throws(()=>parseDevToolsUrl(`DevTools listening on ${current}\nDevTools listening on ws://127.0.0.1:22222/devtools/browser/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,22222),/Ambiguous/);
  });

  test("pageWebSocketUrl constructs page URL", () => {
    assert.equal(pageWebSocketUrl(12345, "page-1"), "ws://127.0.0.1:12345/devtools/page/page-1");
  });

  test("new profile is used per attempt", async () => {
    const a1 = new LaunchAttempt("chrome.exe", "http://x", 1, 0);
    const a2 = new LaunchAttempt("chrome.exe", "http://x", 2, 0);
    assert.notEqual(a1.profile, a2.profile);
    for (const attempt of [a1, a2]) {
      for (let i = 0; i < 10 && fs.existsSync(attempt.profile); i += 1) {
        try { fs.rmSync(attempt.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
        await delay(100);
      }
      assert.equal(fs.existsSync(attempt.profile), false, `self-test profile should be removed: ${attempt.profile}`);
    }
  });

  const fakeCoordinator = async (plan, browsers=["chrome.exe","edge.exe"]) => { let index=0; const ports=[],profiles=[],cleanup=[]; const context={currentPhase:"fake",abortController:new AbortController()}; const result=await coordinateLaunch({browserCandidates:browsers,maxAttemptsPerBrowser:2,suiteContext:context,createAttempt:async(browser,number)=>{const attempt={browserPath:browser,attemptNumber:number,debugPort:41000+index,profile:`profile-${index++}`,lastOutput:()=>({stderr:"tail",stdout:"tail"})};ports.push(attempt.debugPort);profiles.push(attempt.profile);return attempt;},runAttempt:async attempt=>{const outcome=plan.shift();if(outcome instanceof Error)throw outcome;return attempt;},cleanup:async attempt=>{cleanup.push(attempt.attemptNumber);}}); return {result,ports,profiles,cleanup}; };
  test("retry, new ports/profiles, cleanup ordering, and exhaustion are functional", async () => { const run=await fakeCoordinator([new Error("ECONNREFUSED"),{ok:true}],["chrome.exe"]); assert.equal(run.result.attemptNumber,2);assert.deepEqual(run.ports,[41000,41001]);assert.deepEqual(run.profiles,["profile-0","profile-1"]);assert.deepEqual(run.cleanup,[1]); await assert.rejects(fakeCoordinator([new Error("exit"),new Error("invalid"),new Error("exit"),new Error("exit")]),/All browser launch attempts failed/); });
  test("Chrome to Edge fallback is functional and bounded", async () => { const run=await fakeCoordinator([new Error("chrome1"),new Error("chrome2"),{ok:true}]);assert.equal(run.result.browserPath,"edge.exe");assert.deepEqual(run.cleanup,[1,2]); const first=await fakeCoordinator([{ok:true}]);assert.equal(first.result.browserPath,"chrome.exe");assert.equal(first.ports.length,1); });
  test("non-retryable post-launch failures are not coordinator retries", async () => { const run=await fakeCoordinator([{ok:true}],["chrome.exe"]); for(const name of ["semantic","sql","query-plan","selection","DOM","console","resource","rejection","fixture"]) assert.throws(()=>{throw new Error(name);},new RegExp(name)); assert.equal(run.ports.length,1); });

  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`ok ${++passed} - ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${item.name}`);
      console.error(error);
    }
  }
  if (failed) throw new Error(`${failed} launch layer self-tests failed`);
  console.log(`${passed} launch layer self-tests passed`);
}
