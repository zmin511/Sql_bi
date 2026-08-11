import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createProjectSnapshot } from "../src/core/project.js";
import { CdpClient, MockWebSocket, listenServer, closeServer, recoverOwnedProfiles, launchBrowserPage, cleanupAttempt, launchLayerSelfTests, PROFILE_MARKER, PROFILE_SCHEMA, portIsClosed, processIsAlive } from "./helpers/browser-launch-layer.mjs";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TIMEOUTS = { suite: 120000, launch: 10000, cdp: 10000, navigation: 15000, fixture: 20000, selector: 10000, interaction: 10000, cleanup: 10000, serverStart: 5000, serverClose: 5000 };
const suiteStarted = Date.now();

function createSuiteWatchdog(timeout, context, onTimeout = () => {}) {
  let timer;
  let settled = false;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      context.abortController.abort();
      const elapsed = Date.now() - context.startedAt;
      const error = new Error(`suite timeout after ${elapsed}ms; phase=${context.currentPhase}; browserPid=${context.browserPid ?? "unavailable"}; debugPort=${context.debugPort ?? "unavailable"}; url=${context.currentUrl || "unavailable"}`);
      try { onTimeout(error); } finally { reject(error); }
    }, timeout);
  });
  return {
    promise,
    clear() { if (!settled) { settled = true; clearTimeout(timer); } },
    isActive() { return !settled; }
  };
}

function withTimeout(promise, milliseconds, operation, detail = "") {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out after ${milliseconds}ms${detail ? ` (${detail})` : ""}`)), milliseconds);
    })
  ]);
}

async function waitForEvent(client, predicate, operation, timeout = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const index = client.events.findIndex(predicate);
    if (index >= 0) return index;
    await delay(10);
  }
  throw new Error(`${operation} event timed out after ${timeout}ms`);
}

async function cdpLifecycleSelfTest(signal) {
  const exercise = async (event, expected) => {
    const client = new CdpClient(`mock://${event}`, MockWebSocket);
    await client.open();
    const pending = client.command("Test.pending", {}, event === "timeout" ? 20 : 1000);
    if (event !== "timeout") client.socket.emit(event, {});
    await assert.rejects(pending, expected);
    assert.equal(client.pending.size, 0);
    client.close();
    client.close();
  };
  if (signal?.aborted) throw new Error("CDP lifecycle self-test aborted");
  await exercise("close", /CDP WebSocket closed/);
  await exercise("error", /CDP WebSocket failed/);
  await exercise("timeout", /timed out after 20ms/);
}

function semanticCore(snapshot) {
  const clone = structuredClone(snapshot);
  const visualization = clone.snapshot?.view?.visualization;
  if (!visualization || typeof visualization !== "object") throw new Error("Persisted visualization settings missing from semantic snapshot");
  const keys = Object.keys(visualization).sort();
  assert.deepEqual(keys, ["graphFilter", "viewMode"], `Unknown persisted visualization fields: ${keys.join(", ")}`);
  delete clone.snapshot.view.visualization;
  delete clone.focus;
  return clone;
}

function persistedVisualization(snapshot) {
  return snapshot.snapshot?.view?.visualization;
}

function classifyDiagnostics(events, unhandledRejections, allowedMarkers = new Set()) {
  const classified = {
    exceptions: events.filter(event => event.method === "Runtime.exceptionThrown"),
    consoleErrors: events.filter(event => event.method === "Runtime.consoleAPICalled" && event.params.type === "error"),
    resourceErrors: events.filter(event => event.method === "Log.entryAdded" && event.params.entry.level === "error"),
    warnings: events.filter(event => event.method === "Runtime.consoleAPICalled" && event.params.type === "warning"),
    unhandledRejections: [...unhandledRejections]
  };
  const unexpected = [...classified.exceptions, ...classified.consoleErrors, ...classified.resourceErrors, ...classified.unhandledRejections]
    .filter(item => ![...allowedMarkers].some(marker => JSON.stringify(item).includes(marker)));
  return { ...classified, unexpected };
}

function diagnosticPolicySelfTest() {
  const resourceMarker = "__EXACT_RESOURCE_PROBE__";
  const rejectionMarker = "__EXACT_REJECTION_PROBE__";
  const resource = { method: "Log.entryAdded", params: { entry: { level: "error", url: resourceMarker } } };
  const rejection = `Error: ${rejectionMarker}`;
  assert.equal(classifyDiagnostics([resource], []).unexpected.length, 1);
  assert.equal(classifyDiagnostics([], [rejection]).unexpected.length, 1);
  assert.equal(classifyDiagnostics([resource], [rejection], new Set([resourceMarker, rejectionMarker])).unexpected.length, 0);
  assert.equal(classifyDiagnostics([{ ...resource, params: { entry: { level: "error", url: `${resourceMarker}-different` } } }], [], new Set([`${resourceMarker}-exact-only`])).unexpected.length, 1);
}

async function controlledFailureSubprocessTest() {
  const childPath=fileURLToPath(new URL("./helpers/browser-harness-controlled-failure.mjs",import.meta.url));
  const child=spawnSync(process.execPath,[childPath],{encoding:"utf8",timeout:TIMEOUTS.cleanup});
  assert.equal(child.status,23,child.stderr);
  const result=JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(result.errorMessage,"controlled browser harness failure");
  assert.equal(result.profileRemoved,true);assert.equal(result.markerRemoved,true);assert.equal(result.temporaryFileRemoved,true);assert.equal(result.serverClosed,true);
  assert.equal(fs.existsSync(result.profile),false);assert.equal(processIsAlive(result.ownedPid),false);assert.equal(await portIsClosed(result.port),true);
  return result;
}

function state(rows, selected, queryGraph = { viewMode: "split", graphFilter: "all" }) {
  return {
    rows,
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    selected,
    metaById: {},
    boolFilters: {},
    flatten: {},
    serverName: "localhost",
    dbName: "SQLBI",
    schema: "dbo",
    fromTable: "",
    periodFieldId: "",
    periodMode: "relative",
    dateFrom: "",
    dateTo: "",
    periodMonths: 3,
    periodDays: 0,
    periodMonthsFuture: 0,
    periodDaysFuture: 0,
    refDepth: 5,
    relationMode: "detail",
    search: "",
    expanded: Object.fromEntries(rows.filter(row => !row.parentId).map(row => [row.id, true])),
    queryGraph
  };
}

function smallSnapshot() {
  const rows = [
    { id: "doc", object: "Order", title: "Order", internal: "_Document100", metadata: "Document.Order", parentId: null },
    { id: "date", object: "Date", title: "Date", internal: "_Date_Time", type: "Date", parentId: "doc" },
    { id: "value", object: "Value", title: "Value", internal: "_Fld100", type: "Number(15,2)", parentId: "doc" },
    { id: "detail", object: "Items", title: "Items", internal: "_Document100_VT1", metadata: "Document.Order", parentId: "doc" },
    { id: "qty", object: "Quantity", title: "Quantity", internal: "_Fld200", type: "Number(10,3)", parentId: "detail" },
    { id: "catalog", object: "Customers", title: "Catalog.Customers", internal: "_Reference10", metadata: "Catalog.Customers", parentId: null },
    { id: "name", object: "Name", title: "Name", internal: "_Description", type: "String", parentId: "catalog" }
  ];
  return createProjectSnapshot(state(rows, { value: true }), "0.2.2");
}

function largeSnapshot() {
  const rows = [];
  for (let table = 0; table < 80; table += 1) {
    const root = `table-${table}`;
    const isHeader = table === 0;
    const isDetail = table === 1;
    rows.push({
      id: root,
      object: isHeader ? "Order" : isDetail ? "Items" : `Object ${table + 1}`,
      title: isHeader ? "Order" : isDetail ? "Items" : `Object ${table + 1}`,
      internal: isHeader ? "_Document100" : isDetail ? "_Document100_VT1" : `_Reference${1000 + table}`,
      metadata: isHeader || isDetail ? "Document.Order" : `Catalog.Object${table + 1}`,
      parentId: isDetail ? "table-0" : null
    });
    for (let field = 0; field < 8; field += 1) {
      const headerKey = isHeader && field === 7;
      const detailForeignKey = isDetail && field === 7;
      const detailReference = isDetail && field === 1;
      const relationshipKey = headerKey || detailForeignKey;
      rows.push({ id: `field-${table}-${field}`, object: relationshipKey ? "OrderRef" : detailReference ? "CatalogRef" : `Field ${table + 1}.${field + 1}`, title: relationshipKey ? "OrderRef" : detailReference ? "CatalogRef" : `Field ${table + 1}.${field + 1}`, internal: headerKey ? "_IDRRef" : detailForeignKey ? "_Document100_IDRRef" : detailReference ? "_Fld100011RRef" : `_Fld${100000 + table * 10 + field}`, type: relationshipKey ? "UUID" : detailReference ? "Reference.Object3" : field === 0 ? "Number(15,2)" : "String", parentId: root });
    }
  }
  rows.find(row => row.id === "field-1-1").type = "Справочник.Object3";
  rows.find(row => row.id === "table-2").type = "Справочник.Object3";
  const syntheticId = "s:field-1-1:1:_Reference1002:_Description";
  const projectState = state(rows, { "field-0-0": true, "field-1-0": true, "field-1-1": true, [syntheticId]: true });
  projectState.flatten = { "_document100_vt1": true };
  projectState.metaById[syntheticId] = {
    id: syntheticId,
    baseTopId: "field-1-1",
    chain: [{ refInternal: "_Fld100011RRef", targetTable: "_Reference1002", targetKind: "reference", targetType: "Reference.Object3", resolutionMethod: "exact_type" }],
    tableInternal: "_Reference1002",
    field: { object: "Description", title: "Description", internal: "_Description", type: "String" },
    displayPath: "CatalogRef.Description",
    displayPrefix: "CatalogRef"
  };
  return createProjectSnapshot(projectState, "0.2.2");
}

const instrumentationAnchor = "    // init\n    renderTree(); renderSQL();";
const instrumentation = `    const __sqlbiBrowserUnhandledRejections = [];
    window.addEventListener("unhandledrejection", event => {
      __sqlbiBrowserUnhandledRejections.push(String(event.reason && (event.reason.stack || event.reason.message) || event.reason));
    });
    window.__SQLBI_BROWSER_TEST__ = Object.freeze({
      semantic: () => {
        let snapshot = null;
        try {
          snapshot = requireCanonicalProjectApi().createProjectSnapshot(state, APP_VERSION);
          delete snapshot.savedAt;
        } catch {}
        return {
          selectedIds: Object.keys(state.selected).filter(id => state.selected[id]),
          queryPlan: state.queryPlan,
          sql: state.queryResult && state.queryResult.sql || "",
          diagnostics: state.queryResult && state.queryResult.diagnostics || [],
          focus: state.queryGraphFocus && state.queryGraphFocus.id ? {kind:state.queryGraphFocus.kind,id:state.queryGraphFocus.id} : null,
          snapshot
        };
      },
      render: () => renderQueryGraph(),
      unhandledRejections: () => __sqlbiBrowserUnhandledRejections.slice(),
      removeUnhandledRejection: marker => {
        const index=__sqlbiBrowserUnhandledRejections.findIndex(value => value.includes(marker));
        if(index>=0) __sqlbiBrowserUnhandledRejections.splice(index,1);
        return index;
      }
    });
`;

function instrumentProductionHtml(html) {
  const normalized = html.replace(/\r\n/g, "\n");
  const occurrences = normalized.split(instrumentationAnchor).length - 1;
  if (occurrences !== 1) throw new Error(`Browser instrumentation anchor count must be 1, found ${occurrences}`);
  return normalized.replace(instrumentationAnchor, `${instrumentation}${instrumentationAnchor}`);
}

const semanticExpression = "window.__SQLBI_BROWSER_TEST__.semantic()";

async function evaluate(client, expression) {
  const result = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail || "Browser evaluation failed");
  }
  return result.result.value;
}

async function waitFor(client, expression, expected, timeout = TIMEOUTS.selector) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(client, expression) === expected) return;
    await delay(25);
  }
  throw new Error(`Selector wait timed out after ${timeout}ms; expected ${JSON.stringify(expected)} from ${expression}`);
}

async function loadProject(client, snapshot) {
  const encoded = JSON.stringify(JSON.stringify(snapshot));
  await evaluate(client, `(() => {
    const input = document.getElementById("projectFile");
    const file = new File([${encoded}], "browser-fixture.sqlbi", { type: "application/json" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function waitForRenderedProject(client, expected, timeout = TIMEOUTS.fixture) {
  const expression = `(() => {
    const api=window.__SQLBI_BROWSER_TEST__;
    if(!api) return false;
    const semantic=api.semantic();
    const nodeText=document.getElementById('queryGraphNodeCount')?.textContent || '';
    const edgeText=document.getElementById('queryGraphEdgeCount')?.textContent || '';
    const sql=document.getElementById('sql')?.value || '';
    const pending=document.querySelector('[data-render-pending="true"],.query-graph-loading');
    return (nodeText===${JSON.stringify(`Узлов: ${expected.nodes}`)} || nodeText.startsWith(${JSON.stringify(`Таблиц: ${expected.nodes}`)})) &&
      (!${Number.isInteger(expected.edges)} || edgeText===${JSON.stringify(`Связей: ${expected.edges}`)}) &&
      semantic.queryPlan && ['ready','error'].includes(semantic.queryPlan.status) &&
      sql.length>0 && !pending;
  })()`;
  await waitFor(client, expression, true, timeout);
}

async function loadProjectAndWait(client, snapshot, expected, timeout = TIMEOUTS.fixture) {
  await loadProject(client, snapshot);
  await waitForRenderedProject(client, expected, timeout);
}

async function pointerClick(client, selector) {
  const point = await evaluate(client, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element) throw new Error("Pointer target missing"); element.scrollIntoView({block:"center",inline:"center"}); const rect=element.getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; })()`);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function select(client, id, value) {
  await evaluate(client, `(() => { const control=document.getElementById(${JSON.stringify(id)}); control.value=${JSON.stringify(value)}; control.dispatchEvent(new Event("change",{bubbles:true})); return control.value; })()`);
}

async function click(client, selector) {
  return evaluate(client, `(() => { const elements=document.querySelectorAll(${JSON.stringify(selector)}); if(elements.length!==1) throw new Error("Expected one element, found "+elements.length); elements[0].click(); return true; })()`);
}

async function pressEscape(client) {
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}

function leftoverRecoverySelfTest(root) {
  fs.mkdirSync(root, { recursive: true });
  const owned = fs.mkdtempSync(path.join(root, "sql-bi-browser-stale-test-"));
  const unowned = fs.mkdtempSync(path.join(root, "sql-bi-browser-unowned-test-"));
  fs.writeFileSync(path.join(owned, PROFILE_MARKER), JSON.stringify({ schema: PROFILE_SCHEMA, harness: "browser-query-graph", pid: 2147483647 }));
  const result = recoverOwnedProfiles(root);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(unowned), true);
  fs.rmSync(unowned, { recursive: true, force: true });
  return result;
}

async function serverTimeoutSelfTest() {
  const inertStart = {
    once() { return this; },
    off() { return this; },
    listen() {}
  };
  await assert.rejects(listenServer(inertStart, "127.0.0.1", 45678, 20), /server startup timed out.*127\.0\.0\.1:45678/);
  const inertClose = {
    listening: true,
    close() {},
    closeIdleConnections() {}
  };
  await assert.rejects(closeServer(inertClose, new Set(), 20), /forced server close timed out.*activeConnections=0/);
}

const profileRoot = os.tmpdir();
const recoverySelfTest = leftoverRecoverySelfTest(profileRoot);
const recoveryAtStartup = recoverOwnedProfiles(profileRoot);
const rawHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.equal(rawHtml.includes("__SQLBI_BROWSER_TEST__"), false, "raw production HTML must not expose browser test hooks");
const servedHtml = instrumentProductionHtml(rawHtml);
const packageText = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
const packageScripts = JSON.parse(packageText).scripts;
const browserInvocationCount = (packageScripts.test.match(/(?:^|&&\s*)npm run test:browser-graph(?:\s*&&|$)/g) || []).length;
const browserScriptKeyCount = (packageText.match(/"test:browser-graph"\s*:/g) || []).length;
test("browser suite is integrated in npm test exactly once", () => { assert.equal(browserInvocationCount, 1); assert.equal(browserScriptKeyCount, 1); });
const app = http.createServer((request, response) => {
  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(servedHtml);
  } else if (request.url === "/favicon.ico") {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
  } else {
    response.writeHead(404);
    response.end("Not found");
  }
});
const serverSockets = new Set();
app.on("connection", socket => {
  serverSockets.add(socket);
  socket.once("close", () => serverSockets.delete(socket));
});

let browserProcess;
let browserClient;
let client;
let currentAttempt;
let cleanupPromise;
const suiteContext = { startedAt: suiteStarted, currentPhase: "self-tests", browserPid: null, debugPort: null, currentUrl: "", abortController: new AbortController(), timedOut: false };
const watchdog = createSuiteWatchdog(TIMEOUTS.suite, suiteContext, () => { suiteContext.timedOut = true; client?.rejectPending(new Error("suite timeout aborted pending CDP requests")); });
test("suite watchdog uses TIMEOUTS.suite and is active during workflow", () => { assert.equal(TIMEOUTS.suite, 120000); assert.equal(watchdog.isActive(), true); });
test("stale owned profile recovery removes marked stale profile only", () => { assert.ok(recoverySelfTest.removed.some(directory => directory.includes("sql-bi-browser-stale-test-"))); assert.ok(recoverySelfTest.ignored.some(directory => directory.includes("sql-bi-browser-unowned-test-"))); });
test("startup recovery is restricted to valid owned profile markers", () => assert.ok(Array.isArray(recoveryAtStartup.removed)));
await cdpLifecycleSelfTest(suiteContext.abortController.signal);
test("pending CDP requests reject on close, error, and timeout", () => true);
await launchLayerSelfTests(CdpClient);
test("browser launch layer self-tests pass", () => true);
const controlledFailure = await controlledFailureSubprocessTest();
test("controlled failure subprocess removes owned process, server, and profile", () => { assert.equal(controlledFailure.profileRemoved, true); assert.equal(controlledFailure.serverClosed, true); });
await serverTimeoutSelfTest();
test("server startup and close are bounded by explicit timeouts", () => true);
diagnosticPolicySelfTest();
test("resource errors and unhandled rejections are fail-closed with exact allowlist markers", () => true);
{
  const probeContext = { startedAt: Date.now(), currentPhase: "watchdog-self-test", browserPid: null, debugPort: 43210, currentUrl: "http://127.0.0.1/probe", abortController: new AbortController() };
  let cleanupRequested = false;
  const probe = createSuiteWatchdog(20, probeContext, () => { cleanupRequested = true; });
  await assert.rejects(probe.promise, error => /suite timeout/.test(error.message) && /phase=watchdog-self-test/.test(error.message) && /debugPort=43210/.test(error.message));
  assert.equal(probeContext.abortController.signal.aborted, true);
  assert.equal(cleanupRequested, true);
  test("suite timeout fails with phase context and initiates cleanup", () => true);
}
{
  const successContext = { startedAt: Date.now(), currentPhase: "success-self-test", browserPid: null, debugPort: null, currentUrl: "", abortController: new AbortController() };
  const successWatchdog = createSuiteWatchdog(1000, successContext);
  assert.equal(successWatchdog.isActive(), true);
  successWatchdog.clear();
  assert.equal(successWatchdog.isActive(), false);
  test("suite watchdog clears on success", () => true);
}

async function runBrowserWorkflow() {
  suiteContext.currentPhase = "server-start";
  const appPort = await listenServer(app);
  const pageUrl = `http://127.0.0.1:${appPort}/index.html`;
  suiteContext.currentUrl = pageUrl;
  currentAttempt = await launchBrowserPage({
    CdpClient,
    pageUrl,
    suiteContext,
    maxAttemptsPerBrowser: 2,
    operations: {
      stabilizationOptions: {
        healthExpression: "Boolean(document.getElementById('tree') && document.getElementById('queryGraphPanel') && window.__SQLBI_BROWSER_TEST__)"
      }
    },
    onDiagnostic: (diagnostic) => {
      console.log(`Launch diagnostic: ${JSON.stringify(diagnostic)}`);
    }
  });
  browserProcess = currentAttempt.browserProcess;
  browserClient = currentAttempt.browserClient;
  client = currentAttempt.pageClient;
  suiteContext.browserPid = browserProcess.pid;
  suiteContext.debugPort = currentAttempt.debugPort;
  suiteContext.currentPhase = "stabilized-runtime";
  await assert.rejects(
    client.command("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true }, 50),
    /CDP command Runtime\.evaluate timed out after 50ms/
  );
  suiteContext.currentPhase = "diagnostic-probes-after-stabilization";
  test("timed-out CDP command is removed from pending map", () => assert.equal(client.pending.size, 0));
  let allowedProbeCount = 0;
  await evaluate(client, "console.error('__SQLBI_HARNESS_CONSOLE_ERROR_PROBE__')");
  const consoleProbeIndex = await waitForEvent(client, event => event.method === "Runtime.consoleAPICalled" && event.params.type === "error" && event.params.args?.some(arg => arg.value === "__SQLBI_HARNESS_CONSOLE_ERROR_PROBE__"), "console.error policy probe");
  test("console.error is observed by the fail-closed browser policy", () => assert.ok(consoleProbeIndex >= 0));
  if (consoleProbeIndex >= 0) { client.events.splice(consoleProbeIndex, 1); allowedProbeCount += 1; }
  await evaluate(client, "setTimeout(() => { throw new Error('__SQLBI_HARNESS_EXCEPTION_PROBE__'); }, 0); true");
  const exceptionProbeIndex = await waitForEvent(client, event => event.method === "Runtime.exceptionThrown" && JSON.stringify(event.params).includes("__SQLBI_HARNESS_EXCEPTION_PROBE__"), "uncaught exception policy probe");
  test("uncaught exception is observed by the fail-closed browser policy", () => assert.ok(exceptionProbeIndex >= 0));
  if (exceptionProbeIndex >= 0) { client.events.splice(exceptionProbeIndex, 1); allowedProbeCount += 1; }
  suiteContext.currentPhase = "stabilized-page-contract";
  assert.equal(await evaluate(client, "typeof window.__SQLBI_BROWSER_TEST__"), "object", "instrumented page must expose VM-local hooks");
  const rejectionMarker = "__SQLBI_HARNESS_UNHANDLED_REJECTION_PROBE__";
  await evaluate(client, `window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {promise:Promise.resolve(), reason:new Error(${JSON.stringify(rejectionMarker)})})); true`);
  await waitFor(client, `window.__SQLBI_BROWSER_TEST__.unhandledRejections().some(value=>value.includes(${JSON.stringify(rejectionMarker)}))`, true, TIMEOUTS.interaction);
  const removedRejection = await evaluate(client, `window.__SQLBI_BROWSER_TEST__.removeUnhandledRejection(${JSON.stringify(rejectionMarker)})`);
  test("unhandled rejection is observed by the fail-closed browser policy", () => assert.ok(removedRejection >= 0));
  allowedProbeCount += 1;
  const performanceRows = [];
  suiteContext.currentPhase = "browser-contracts";
  async function characterize(name, action, timeout = TIMEOUTS.interaction) {
    const started = Date.now();
    const inPage = await evaluate(client, "performance.now()");
    await withTimeout(action(), timeout, name, pageUrl);
    const endedInPage = await evaluate(client, "performance.now()");
    performanceRows.push({ operation: name, inPageMs: Number((endedInPage - inPage).toFixed(2)), roundTripMs: Date.now() - started });
  }

  const emptySemantic = await evaluate(client, semanticExpression);
  await pressEscape(client);
  await pressEscape(client);
  const emptyAfterEscape = await evaluate(client, semanticExpression);
  test("Escape before fixture load is safe", () => assert.deepEqual(emptyAfterEscape, emptySemantic));

  await select(client, "queryGraphScope", "all");
  const small = smallSnapshot();
  await characterize("small project load + initial render", () => loadProjectAndWait(client, small, { nodes: 7 }), TIMEOUTS.fixture);
  const baseline = await evaluate(client, semanticExpression);
  assert.match(baseline.sql, /^SELECT/);

  await pointerClick(client, '#queryGraphNodes [data-node-id="row:value"]');
  const nodeFocus = await evaluate(client, `({count:document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length,id:document.querySelector('#queryGraphNodes [data-node-id].focus')?.dataset.nodeId,semantic:${semanticExpression}})`);
  test("final node is clickable once", () => assert.deepEqual({ count: nodeFocus.count, id: nodeFocus.id }, { count: 1, id: "row:value" }));
  test("node focus preserves semantic state", () => { assert.deepEqual(semanticCore(nodeFocus.semantic), semanticCore(baseline)); assert.deepEqual(persistedVisualization(nodeFocus.semantic), persistedVisualization(baseline)); });
  await evaluate(client, "document.getElementById('sql').focus(); document.getElementById('sql').value");
  await pressEscape(client);
  const nodeFocusAfterEscape = await evaluate(client, "document.querySelectorAll('#queryGraphNodes .focus').length");
  const sqlAfterFocusedEscape = await evaluate(client, "document.getElementById('sql').value");
  test("Escape clears node focus", () => assert.equal(nodeFocusAfterEscape, 0));
  test("Escape in SQL textarea preserves SQL text", () => assert.equal(sqlAfterFocusedEscape, baseline.sql));

  await pointerClick(client, '#queryGraphNodes [data-edge-id="tree:doc:value"]');
  const edgeFocus = await evaluate(client, `({count:document.querySelectorAll('#queryGraphNodes [data-edge-id].focus').length,id:document.querySelector('#queryGraphNodes [data-edge-id].focus')?.dataset.edgeId,semantic:${semanticExpression}})`);
  test("final edge is clickable once", () => assert.deepEqual({ count: edgeFocus.count, id: edgeFocus.id }, { count: 1, id: "tree:doc:value" }));
  test("edge focus preserves semantic state", () => { assert.deepEqual(semanticCore(edgeFocus.semantic), semanticCore(baseline)); assert.deepEqual(persistedVisualization(edgeFocus.semantic), persistedVisualization(baseline)); });
  await pressEscape(client);
  await pressEscape(client);
  const edgeFocusAfterEscape = await evaluate(client, "document.querySelectorAll('#queryGraphNodes .focus').length");
  test("Escape clears edge focus and repeated Escape is safe", () => assert.equal(edgeFocusAfterEscape, 0));

  for (const filter of ["all", "active", "sql", "errors"]) {
    await select(client, "queryGraphFilter", filter);
    const current = await evaluate(client, semanticExpression);
    test(`filter ${filter} changes only persisted graphFilter`, () => { assert.deepEqual(semanticCore(current), semanticCore(baseline)); assert.deepEqual(persistedVisualization(current), { viewMode: "split", graphFilter: filter }); });
  }
  await select(client, "queryGraphFilter", "all");
  await click(client, '#queryGraphNodes [data-node-id="row:value"]');
  const repeatedNodeFocus = await evaluate(client, "document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length");
  await pressEscape(client);
  await click(client, '#queryGraphNodes [data-edge-id="tree:doc:value"]');
  const repeatedEdgeFocus = await evaluate(client, "document.querySelectorAll('#queryGraphNodes [data-edge-id].focus').length");
  await pressEscape(client);
  test("repeated render does not double node action", () => assert.equal(repeatedNodeFocus, 1));
  test("repeated render does not double edge action", () => assert.equal(repeatedEdgeFocus, 1));
  for (const mode of ["tree", "graph", "split"]) {
    await select(client, "structureViewMode", mode);
    const current = await evaluate(client, semanticExpression);
    test(`mode ${mode} changes only persisted viewMode`, () => { assert.deepEqual(semanticCore(current), semanticCore(baseline)); assert.deepEqual(persistedVisualization(current), { viewMode: mode, graphFilter: "all" }); });
  }
  await click(client, '#queryGraphNodes [data-node-id="row:value"]');
  await select(client, "queryGraphFilter", "active");
  await characterize("small project reload", () => loadProjectAndWait(client, small, { nodes: 7 }), TIMEOUTS.fixture);
  await waitFor(client, "document.getElementById('queryGraphFilter').value", "all");
  const reloaded = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes .focus').length,semantic:${semanticExpression}})`);
  test("project reload restores persisted controls without transient focus", () => { assert.equal(reloaded.focus, 0); assert.equal(reloaded.semantic.focus, null); assert.deepEqual(reloaded.semantic, baseline); assert.deepEqual(persistedVisualization(reloaded.semantic), { viewMode: "split", graphFilter: "all" }); });

  await client.command("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  const responsive = await evaluate(client, `(() => {
    const grid=document.querySelector('.period-grid');
    const inputs=Array.from(grid.querySelectorAll('input')).map(input=>input.getBoundingClientRect());
    const gridRect=grid.getBoundingClientRect();
    return {
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      gridInside:gridRect.left>=0&&gridRect.right<=document.documentElement.clientWidth,
      inputsUsable:inputs.length===4&&inputs.every(rect=>rect.width>=80&&rect.left>=0&&rect.right<=document.documentElement.clientWidth)
    };
  })()`);
  test("1366px viewport has no global horizontal overflow", () => assert.equal(responsive.overflow, false));
  test("LOCAL12A period grid remains usable at 1366px", () => assert.deepEqual({ gridInside: responsive.gridInside, inputsUsable: responsive.inputsUsable }, { gridInside: true, inputsUsable: true }));
  await client.command("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  const large = largeSnapshot();
  await characterize("large project load + initial render", () => loadProjectAndWait(client, large, { nodes: 721, edges: 643 }), TIMEOUTS.fixture);
  const largeBaseline = await evaluate(client, semanticExpression);
  const largeCounts = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,dom:document.querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
  await characterize("filter active", () => select(client, "queryGraphFilter", "active"));
  await characterize("filter all", () => select(client, "queryGraphFilter", "all"));
  await characterize("repeated render", () => evaluate(client, "window.__SQLBI_BROWSER_TEST__.render()"));
  const largeRepeated = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,dom:document.querySelectorAll('*').length,semantic:${semanticExpression}})`);
  await characterize("node focus", () => click(client, '#queryGraphNodes [data-node-id="row:field-0-0"]'));
  const largeFocused = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length,id:document.querySelector('#queryGraphNodes [data-node-id].focus')?.dataset.nodeId,dimmed:document.querySelectorAll('#queryGraphNodes .dim').length,details:document.getElementById('queryGraphDetails').textContent,semantic:${semanticExpression}})`);
  await pressEscape(client);
  const largeNodeAfterEscape = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes .focus').length,dimmed:document.querySelectorAll('#queryGraphNodes .dim').length,details:document.getElementById('queryGraphDetails').textContent,semantic:${semanticExpression}})`);
  const largeEdgeSelector = '#queryGraphNodes [data-edge-id^="join:header_detail:"]';
  await characterize("edge focus", () => click(client, largeEdgeSelector));
  const largeEdgeFocused = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes [data-edge-id].focus').length,id:document.querySelector('#queryGraphNodes [data-edge-id].focus')?.dataset.edgeId,dimmed:document.querySelectorAll('#queryGraphNodes .dim').length,details:document.getElementById('queryGraphDetails').textContent,semantic:${semanticExpression}})`);
  await pressEscape(client);
  const largeEdgeAfterEscape = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes .focus').length,dimmed:document.querySelectorAll('#queryGraphNodes .dim').length,details:document.getElementById('queryGraphDetails').textContent,semantic:${semanticExpression}})`);
  for (const mode of ["tree", "graph", "split"]) {
    await characterize(`mode ${mode}`, () => select(client, "structureViewMode", mode));
    const current = await evaluate(client, semanticExpression);
    test(`large mode ${mode} changes only persisted viewMode`, () => { assert.deepEqual(semanticCore(current), semanticCore(largeBaseline)); assert.deepEqual(persistedVisualization(current), { viewMode: mode, graphFilter: "all" }); });
  }
  for (const filter of ["all", "active", "sql", "errors"]) {
    await characterize(`large filter ${filter}`, () => select(client, "queryGraphFilter", filter));
    const current = await evaluate(client, semanticExpression);
    test(`large filter ${filter} changes only persisted graphFilter`, () => { assert.deepEqual(semanticCore(current), semanticCore(largeBaseline)); assert.deepEqual(persistedVisualization(current), { viewMode: "split", graphFilter: filter }); });
  }
  await select(client, "queryGraphFilter", "all");
  const finalLargeCounts = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,dom:document.querySelectorAll('*').length,duplicates:Array.from(document.querySelectorAll('[id]')).length-new Set(Array.from(document.querySelectorAll('[id]')).map(element=>element.id)).size})`);
  console.log("Large graph characterization:", JSON.stringify({ counts: largeCounts, planStatus: largeBaseline.queryPlan && largeBaseline.queryPlan.status, joins: largeBaseline.queryPlan && largeBaseline.queryPlan.joins, diagnostics: largeBaseline.diagnostics }, null, 2));
  test("large graph has deterministic DOM size", () => { assert.equal(largeCounts.nodes, 721); assert.equal(largeCounts.edges, 643); });
  test("large fixture exercises an active header/detail query-plan relationship", () => {
    const joins = largeBaseline.queryPlan && largeBaseline.queryPlan.joins || [];
    assert.ok(joins.some(join => join.kind === "header_detail" && join.status === "sql"));
    assert.ok(joins.some(join => join.kind === "reference" && join.status === "sql"));
  });
  test("large graph repeated render does not multiply DOM", () => assert.deepEqual({ nodes: largeRepeated.nodes, edges: largeRepeated.edges, dom: largeRepeated.dom }, { nodes: largeCounts.nodes, edges: largeCounts.edges, dom: largeCounts.dom }));
  test("large node focus has exact ID, details, and dimming", () => { assert.equal(largeFocused.focus, 1); assert.equal(largeFocused.id, "row:field-0-0"); assert.ok(largeFocused.dimmed > 0); assert.match(largeFocused.details, /_Fld100000/); assert.doesNotMatch(largeFocused.details, /_Document100_IDRRef/); assert.deepEqual(semanticCore(largeFocused.semantic), semanticCore(largeBaseline)); assert.deepEqual(persistedVisualization(largeFocused.semantic), persistedVisualization(largeBaseline)); });
  test("large node Escape resets focus, details, and dimming without semantic changes", () => { assert.deepEqual({focus:largeNodeAfterEscape.focus,dimmed:largeNodeAfterEscape.dimmed,details:largeNodeAfterEscape.details}, {focus:0,dimmed:0,details:""}); assert.equal(largeNodeAfterEscape.semantic.focus, null); assert.deepEqual(largeNodeAfterEscape.semantic, largeBaseline); });
  test("large edge focus has exact model identity, details, and dimming", () => { const headerJoin=largeBaseline.queryPlan.joins.find(join=>join.kind==="header_detail"); assert.equal(largeEdgeFocused.focus, 1); assert.match(largeEdgeFocused.id, /^join:header_detail:/); assert.ok(largeEdgeFocused.id.includes(headerJoin.id)); assert.ok(largeEdgeFocused.dimmed > 0); assert.match(largeEdgeFocused.details, /header_detail/); assert.match(largeEdgeFocused.details, /SQL/); assert.deepEqual(semanticCore(largeEdgeFocused.semantic), semanticCore(largeBaseline)); assert.deepEqual(persistedVisualization(largeEdgeFocused.semantic), persistedVisualization(largeBaseline)); });
  test("large edge Escape resets focus, details, and dimming without semantic changes", () => { assert.deepEqual({focus:largeEdgeAfterEscape.focus,dimmed:largeEdgeAfterEscape.dimmed,details:largeEdgeAfterEscape.details}, {focus:0,dimmed:0,details:""}); assert.equal(largeEdgeAfterEscape.semantic.focus, null); assert.deepEqual(largeEdgeAfterEscape.semantic, largeBaseline); });
  test("large graph final identical state has stable DOM", () => assert.deepEqual(finalLargeCounts, { nodes: largeCounts.nodes, edges: largeCounts.edges, dom: largeCounts.dom, duplicates: 0 }));
  test("large graph has no global horizontal overflow", () => assert.equal(largeCounts.overflow, false));
  await select(client, "queryGraphScope", "query");
  await characterize("query-plan graph load", () => loadProjectAndWait(client, large, { nodes: 3, edges: 2 }), TIMEOUTS.fixture);
  const queryGraph = await evaluate(client, `({scope:document.getElementById("queryGraphScope").value,nodes:Array.from(document.querySelectorAll("#queryGraphNodes [data-node-id]")).map(node=>({id:node.dataset.nodeId,text:node.textContent})),edges:Array.from(document.querySelectorAll("#queryGraphNodes [data-edge-id]")).map(edge=>({id:edge.dataset.edgeId,text:edge.textContent})),details:document.getElementById("queryGraphDetails").textContent,empty:document.getElementById("queryGraphEmpty").textContent})`);
  await pointerClick(client, '#queryGraphNodes [data-node-id="alias:R1"]');
  const queryNodeDetails = await evaluate(client, "document.getElementById('queryGraphDetails').textContent");
  await pointerClick(client, '#queryGraphNodes [data-node-id="alias:T"]');
  const relatedBefore = await evaluate(client, "document.getElementById('queryGraphDetails').textContent");
  await pointerClick(client, '[data-relation-id="reference:field-1-1:_Reference1002"][data-field-internal="_Code"]');
  const relatedAfter = await evaluate(client, semanticExpression);
  await pointerClick(client, '#queryGraphNodes [data-edge-id^="join:header_detail:"]');
  const queryEdgeDetails = await evaluate(client, "document.getElementById('queryGraphDetails').textContent");
  test("query scope is the explicit default query-plan mode", () => assert.equal(queryGraph.scope, "query"));
  test("query graph exposes only canonical H T R1 alias participants", () => { assert.deepEqual(queryGraph.nodes.map(node=>node.id), ["alias:H","alias:T","alias:R1"]); assert.ok(queryGraph.nodes.every(node=>!node.id.startsWith("row:"))); });
  test("query graph nodes present aliases, human names, physical tables, roles, and compact summaries", () => { const text=queryGraph.nodes.map(node=>node.text).join(" "); assert.match(text,/H/); assert.match(text,/T/); assert.match(text,/R1/); assert.match(text,/Order/); assert.match(text,/Items/); assert.match(text,/_Document100/); assert.match(text,/_Document100_VT1/); assert.match(text,/_Reference1002/); assert.match(text,/Документ|Табличная часть|Справочник/); assert.match(text,/Поля:/); });
  test("query graph exposes canonical header/detail and reference SQL edges", () => { assert.equal(queryGraph.edges.length, 2); assert.ok(queryGraph.edges.some(edge=>edge.text.includes("_Document100_IDRRef"))); assert.ok(queryGraph.edges.some(edge=>edge.text.includes("_Fld100011RRef"))); });
  test("query graph edges keep directional aliases and compact physical-column labels", () => { const text=queryGraph.edges.map(edge=>edge.text).join(" "); assert.match(text,/T → H/); assert.match(text,/T → R1/); assert.match(text,/_Document100_IDRRef → _IDRRef/); assert.match(text,/_Fld100011RRef → _IDRRef/); });
  test("reference alias node focus exposes projected field details", () => assert.match(queryNodeDetails, /R1|_Description/));
  test("query node exposes confirmed related data and adds one field through canonical selection", () => { assert.match(relatedBefore,/Доступные связанные данные/); assert.ok(relatedAfter.selectedIds.includes("s:field-1-1:1:_Reference1002:_Code")); assert.match(relatedAfter.sql,/R1\.\[_Code\]/); assert.equal((relatedAfter.sql.match(/LEFT JOIN \[SQLBI\]\.\[dbo\]\.\[_Reference1002\] AS R1/g)||[]).length,1); });
  test("query edge focus exposes physical join details", () => assert.match(queryEdgeDetails, /_Document100_IDRRef|header_detail/));
  console.log("Browser performance characterization (in-page elapsed includes production event/render; round-trip includes CDP):");
  console.table(performanceRows);
  const unhandledRejections = await evaluate(client, "window.__SQLBI_BROWSER_TEST__.unhandledRejections()");
  const allowed = Array.from({ length: allowedProbeCount }, () => "explicit harness policy probe");
  const diagnostics = classifyDiagnostics(client.events, unhandledRejections);
  test("tested browser flows have no unexpected fail-closed diagnostics", () => assert.equal(diagnostics.unexpected.length, 0));
  console.log(`Browser diagnostics: exceptions=${diagnostics.exceptions.length}, consoleErrors=${diagnostics.consoleErrors.length}, resourceLogErrors=${diagnostics.resourceErrors.length}, unhandledRejections=${diagnostics.unhandledRejections.length}, warnings=${diagnostics.warnings.length}, allowed=${allowed.length}, unexpected=${diagnostics.unexpected.length}`);

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
  if (failed) throw new Error(`${failed} browser query graph tests failed`);
  console.log(`\n${passed} browser query graph tests passed (${path.basename(currentAttempt?.browserPath || "unknown")})`);
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
  suiteContext.currentPhase = "cleanup";
  if (currentAttempt) {
    await cleanupAttempt(currentAttempt, suiteContext);
  }
  await closeServer(app, serverSockets);
  console.log(`Browser cleanup: CDP=closed, browser=stopped, server=closed, elapsedMs=${Date.now() - suiteStarted}`);
  })();
  return cleanupPromise;
}

try {
  await Promise.race([runBrowserWorkflow(), watchdog.promise]);
  watchdog.clear();
} catch (error) {
  console.error(`Browser workflow failed in phase=${suiteContext.currentPhase}; browserExit=${browserProcess?.exitCode}; lastOutput=${JSON.stringify(currentAttempt?.lastOutput?.(2000))}: ${error.stack || error}`);
  throw error;
} finally {
  watchdog.clear();
  await cleanup();
}
