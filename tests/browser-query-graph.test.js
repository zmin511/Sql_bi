import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createProjectSnapshot } from "../src/core/project.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TIMEOUTS = { suite: 120000, launch: 10000, cdp: 10000, navigation: 15000, fixture: 20000, selector: 10000, interaction: 10000, cleanup: 10000 };
const suiteStarted = Date.now();

function withTimeout(promise, milliseconds, operation, detail = "") {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out after ${milliseconds}ms${detail ? ` (${detail})` : ""}`)), milliseconds);
    })
  ]);
}

function browserExecutable() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error("Microsoft Edge or Google Chrome is required for browser characterization.");
  return executable;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForJson(url, attempts = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForPageTarget(url) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUTS.launch) {
    const targets = await waitForJson(url, 5);
    const target = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl);
    if (target) return target;
    await delay(50);
  }
  throw new Error(`Browser page target timed out after ${TIMEOUTS.launch}ms (${url})`);
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

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
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
    this.rejectPending(new Error("CDP client closed by suite cleanup"));
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
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
  const syntheticId = "s:field-1-1:1:_Reference1002:_Description";
  const projectState = state(rows, { "field-0-0": true, "field-1-0": true, [syntheticId]: true });
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
const instrumentation = `    window.__SQLBI_BROWSER_TEST__ = Object.freeze({
      semantic: () => {
        let snapshot = null;
        try {
          snapshot = requireCanonicalProjectApi().createProjectSnapshot(state, APP_VERSION);
          delete snapshot.savedAt;
          if (snapshot.view) delete snapshot.view.visualization;
        } catch {}
        return {
          selectedIds: Object.keys(state.selected).filter(id => state.selected[id]),
          queryPlan: state.queryPlan,
          sql: state.queryResult && state.queryResult.sql || "",
          diagnostics: state.queryResult && state.queryResult.diagnostics || [],
          snapshot
        };
      },
      render: () => renderQueryGraph()
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

const browserPath = browserExecutable();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-browser-"));
const ownershipMarker = path.join(profile, ".sql-bi-browser-harness-owned");
fs.writeFileSync(ownershipMarker, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
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

let browserProcess;
let client;
try {
  await new Promise((resolve, reject) => app.listen(0, "127.0.0.1", resolve).once("error", reject));
  const appPort = app.address().port;
  const debugPort = await availablePort();
  const pageUrl = `http://127.0.0.1:${appPort}/index.html`;
  browserProcess = spawn(browserPath, [
    "--headless=new",
    "--disable-extensions",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--window-size=1920,1080",
    pageUrl
  ], { stdio: "ignore" });
  const target = await waitForPageTarget(`http://127.0.0.1:${debugPort}/json/list`);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.command("Page.enable");
  await client.command("Runtime.enable");
  await client.command("Log.enable");
  await assert.rejects(
    client.command("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true }, 50),
    /CDP command Runtime\.evaluate timed out after 50ms/
  );
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
  await client.command("Page.navigate", { url: pageUrl }, TIMEOUTS.navigation);
  await waitFor(client, "document.readyState", "complete");
  assert.equal(await evaluate(client, "typeof window.__SQLBI_BROWSER_TEST__"), "object", "instrumented page must expose VM-local hooks");
  const performanceRows = [];
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

  const small = smallSnapshot();
  await characterize("small project load + initial render", () => loadProject(client, small), TIMEOUTS.fixture);
  await waitFor(client, "document.getElementById('queryGraphNodeCount').textContent", "Узлов: 7");
  const baseline = await evaluate(client, semanticExpression);
  assert.match(baseline.sql, /^SELECT/);

  await pointerClick(client, '#queryGraphNodes [data-node-id="row:value"]');
  const nodeFocus = await evaluate(client, `({count:document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length,id:document.querySelector('#queryGraphNodes [data-node-id].focus')?.dataset.nodeId,semantic:${semanticExpression}})`);
  test("final node is clickable once", () => assert.deepEqual({ count: nodeFocus.count, id: nodeFocus.id }, { count: 1, id: "row:value" }));
  test("node focus preserves semantic state", () => assert.deepEqual(nodeFocus.semantic, baseline));
  await evaluate(client, "document.getElementById('sql').focus(); document.getElementById('sql').value");
  await pressEscape(client);
  const nodeFocusAfterEscape = await evaluate(client, "document.querySelectorAll('#queryGraphNodes .focus').length");
  const sqlAfterFocusedEscape = await evaluate(client, "document.getElementById('sql').value");
  test("Escape clears node focus", () => assert.equal(nodeFocusAfterEscape, 0));
  test("Escape in SQL textarea preserves SQL text", () => assert.equal(sqlAfterFocusedEscape, baseline.sql));

  await pointerClick(client, '#queryGraphNodes [data-edge-id="tree:doc:value"]');
  const edgeFocus = await evaluate(client, `({count:document.querySelectorAll('#queryGraphNodes [data-edge-id].focus').length,id:document.querySelector('#queryGraphNodes [data-edge-id].focus')?.dataset.edgeId,semantic:${semanticExpression}})`);
  test("final edge is clickable once", () => assert.deepEqual({ count: edgeFocus.count, id: edgeFocus.id }, { count: 1, id: "tree:doc:value" }));
  test("edge focus preserves semantic state", () => assert.deepEqual(edgeFocus.semantic, baseline));
  await pressEscape(client);
  await pressEscape(client);
  const edgeFocusAfterEscape = await evaluate(client, "document.querySelectorAll('#queryGraphNodes .focus').length");
  test("Escape clears edge focus and repeated Escape is safe", () => assert.equal(edgeFocusAfterEscape, 0));

  for (const filter of ["all", "active", "sql", "errors"]) {
    await select(client, "queryGraphFilter", filter);
    const current = await evaluate(client, semanticExpression);
    test(`filter ${filter} preserves semantic state`, () => assert.deepEqual(current, baseline));
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
    test(`mode ${mode} preserves semantic state`, () => assert.deepEqual(current, baseline));
  }
  await click(client, '#queryGraphNodes [data-node-id="row:value"]');
  await select(client, "queryGraphFilter", "active");
  await characterize("small project reload", () => loadProject(client, small), TIMEOUTS.fixture);
  await waitFor(client, "document.getElementById('queryGraphFilter').value", "all");
  const reloaded = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes .focus').length,semantic:${semanticExpression}})`);
  test("project reload restores semantics without transient focus", () => { assert.equal(reloaded.focus, 0); assert.deepEqual(reloaded.semantic, baseline); });

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
  await characterize("large project load + initial render", () => loadProject(client, large), TIMEOUTS.fixture);
  await waitFor(client, "document.getElementById('queryGraphNodeCount').textContent", "Узлов: 721");
  const largeBaseline = await evaluate(client, semanticExpression);
  const largeCounts = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,dom:document.querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
  await characterize("filter active", () => select(client, "queryGraphFilter", "active"));
  await characterize("filter all", () => select(client, "queryGraphFilter", "all"));
  await characterize("repeated render", () => evaluate(client, "window.__SQLBI_BROWSER_TEST__.render()"));
  const largeRepeated = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,dom:document.querySelectorAll('*').length,semantic:${semanticExpression}})`);
  await characterize("node focus", () => click(client, '#queryGraphNodes [data-node-id="row:field-0-0"]'));
  const largeFocused = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length,semantic:${semanticExpression}})`);
  await pressEscape(client);
  const largeEdgeSelector = '#queryGraphNodes [data-edge-id^="join:header_detail:"]';
  await characterize("edge focus", () => click(client, largeEdgeSelector));
  const largeEdgeFocused = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes [data-edge-id].focus').length,details:document.getElementById('queryGraphDetails').textContent,semantic:${semanticExpression}})`);
  await pressEscape(client);
  for (const mode of ["tree", "graph", "split"]) {
    await characterize(`mode ${mode}`, () => select(client, "structureViewMode", mode));
    const current = await evaluate(client, semanticExpression);
    test(`large mode ${mode} preserves semantic state`, () => assert.deepEqual(current, largeBaseline));
  }
  for (const filter of ["all", "active", "sql", "errors"]) {
    await characterize(`large filter ${filter}`, () => select(client, "queryGraphFilter", filter));
    const current = await evaluate(client, semanticExpression);
    test(`large filter ${filter} preserves semantic state`, () => assert.deepEqual(current, largeBaseline));
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
  test("large graph retains click interaction and semantics", () => { assert.equal(largeFocused.focus, 1); assert.deepEqual(largeFocused.semantic, largeBaseline); });
  test("large graph edge focus and details preserve semantics", () => { assert.equal(largeEdgeFocused.focus, 1); assert.ok(largeEdgeFocused.details.length > 0); assert.deepEqual(largeEdgeFocused.semantic, largeBaseline); });
  test("large graph final identical state has stable DOM", () => assert.deepEqual(finalLargeCounts, { nodes: largeCounts.nodes, edges: largeCounts.edges, dom: largeCounts.dom, duplicates: 0 }));
  test("large graph has no global horizontal overflow", () => assert.equal(largeCounts.overflow, false));
  console.log("Browser performance characterization (in-page elapsed includes production event/render; round-trip includes CDP):");
  console.table(performanceRows);
  const exceptions = client.events.filter(event => event.method === "Runtime.exceptionThrown");
  const consoleEvents = client.events.filter(event => event.method === "Runtime.consoleAPICalled");
  const consoleErrors = consoleEvents.filter(event => event.params.type === "error");
  const consoleWarnings = consoleEvents.filter(event => event.params.type === "warning");
  const logErrors = client.events.filter(event => event.method === "Log.entryAdded" && event.params.entry.level === "error");
  const allowed = Array.from({ length: allowedProbeCount }, () => "explicit harness policy probe");
  const unexpected = [...exceptions, ...consoleErrors];
  test("tested browser flows have no uncaught exceptions or console errors", () => assert.equal(unexpected.length, 0));
  console.log(`Browser diagnostics: consoleErrors=${consoleErrors.length}, resourceLogErrors=${logErrors.length}, warnings=${consoleWarnings.length}, allowed=${allowed.length}, unexpected=${unexpected.length}`);

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
  console.log(`\n${passed} browser query graph tests passed (${path.basename(browserPath)})`);
} finally {
  if (client) {
    try { await client.command("Browser.close", {}, TIMEOUTS.cleanup); } catch {}
    client.close();
  }
  if (browserProcess && browserProcess.exitCode === null) {
    const exited = new Promise(resolve => browserProcess.once("exit", resolve));
    try {
      await withTimeout(exited, TIMEOUTS.cleanup, "browser process cleanup");
    } catch {
      if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(browserProcess.pid), "/T", "/F"], { stdio: "ignore" });
      else browserProcess.kill("SIGKILL");
      await withTimeout(exited, TIMEOUTS.cleanup, "forced browser process cleanup");
    }
  }
  app.closeAllConnections?.();
  await new Promise(resolve => app.close(resolve));
  let profileRemoved = false;
  for (let attempt = 0; attempt < 10 && !profileRemoved; attempt += 1) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); profileRemoved = true; }
    catch (error) { if (attempt === 9) throw error; await delay(200); }
  }
  console.log(`Browser cleanup: CDP=closed, browser=stopped, server=closed, profileRemoved=${!fs.existsSync(profile)}, elapsedMs=${Date.now() - suiteStarted}`);
}
