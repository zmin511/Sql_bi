import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createProjectSnapshot } from "../src/core/project.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function browserExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
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

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
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
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
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
    rows.push({ id: root, object: `Object ${table + 1}`, title: `Object ${table + 1}`, internal: `_Reference${1000 + table}`, metadata: `Catalog.Object${table + 1}`, parentId: null });
    for (let field = 0; field < 8; field += 1) {
      rows.push({ id: `field-${table}-${field}`, object: `Field ${table + 1}.${field + 1}`, title: `Field ${table + 1}.${field + 1}`, internal: `_Fld${100000 + table * 10 + field}`, type: field === 0 ? "Number(15,2)" : "String", parentId: root });
    }
  }
  return createProjectSnapshot(state(rows, { "field-0-0": true }), "0.2.2");
}

const semanticExpression = `({
  sql: document.getElementById("sql").value,
  selected: document.getElementById("selCount").textContent,
  planStatus: document.getElementById("queryPlanStatus").textContent,
  planCounts: document.getElementById("queryPlanCounts").textContent,
  diagnostics: document.getElementById("diag").textContent
})`;

async function evaluate(client, expression) {
  const result = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail || "Browser evaluation failed");
  }
  return result.result.value;
}

async function waitFor(client, expression, expected, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(client, expression) === expected) return;
    await delay(25);
  }
  throw new Error(`Browser condition did not reach ${JSON.stringify(expected)}: ${expression}`);
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
const app = http.createServer((request, response) => {
  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
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
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find(item => item.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, "headless browser page target is missing");
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.command("Page.enable");
  await client.command("Runtime.enable");
  await client.command("Page.navigate", { url: pageUrl });
  await waitFor(client, "document.readyState", "complete");

  const emptySemantic = await evaluate(client, semanticExpression);
  await pressEscape(client);
  await pressEscape(client);
  const emptyAfterEscape = await evaluate(client, semanticExpression);
  test("Escape before fixture load is safe", () => assert.deepEqual(emptyAfterEscape, emptySemantic));

  const small = smallSnapshot();
  await loadProject(client, small);
  await waitFor(client, "document.getElementById('queryGraphNodeCount').textContent", "Узлов: 7");
  const baseline = await evaluate(client, semanticExpression);
  assert.match(baseline.sql, /^SELECT/);

  await click(client, '#queryGraphNodes [data-node-id="row:value"]');
  const nodeFocus = await evaluate(client, `({count:document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length,id:document.querySelector('#queryGraphNodes [data-node-id].focus')?.dataset.nodeId,semantic:${semanticExpression}})`);
  test("final node is clickable once", () => assert.deepEqual({ count: nodeFocus.count, id: nodeFocus.id }, { count: 1, id: "row:value" }));
  test("node focus preserves semantic state", () => assert.deepEqual(nodeFocus.semantic, baseline));
  await evaluate(client, "document.getElementById('sql').focus(); document.getElementById('sql').value");
  await pressEscape(client);
  const nodeFocusAfterEscape = await evaluate(client, "document.querySelectorAll('#queryGraphNodes .focus').length");
  const sqlAfterFocusedEscape = await evaluate(client, "document.getElementById('sql').value");
  test("Escape clears node focus", () => assert.equal(nodeFocusAfterEscape, 0));
  test("Escape in SQL textarea preserves SQL text", () => assert.equal(sqlAfterFocusedEscape, baseline.sql));

  await click(client, '#queryGraphNodes [data-edge-id="tree:doc:value"]');
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
  await loadProject(client, small);
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
  await loadProject(client, large);
  await waitFor(client, "document.getElementById('queryGraphNodeCount').textContent", "Узлов: 720");
  const largeBaseline = await evaluate(client, semanticExpression);
  const largeCounts = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,dom:document.querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
  await select(client, "queryGraphFilter", "active");
  await select(client, "queryGraphFilter", "all");
  const largeRepeated = await evaluate(client, `({nodes:document.querySelectorAll('#queryGraphNodes [data-node-id]').length,edges:document.querySelectorAll('#queryGraphNodes [data-edge-id]').length,semantic:${semanticExpression}})`);
  await click(client, '#queryGraphNodes [data-node-id="row:field-0-0"]');
  const largeFocused = await evaluate(client, `({focus:document.querySelectorAll('#queryGraphNodes [data-node-id].focus').length,semantic:${semanticExpression}})`);
  test("large graph has deterministic DOM size", () => assert.deepEqual({ nodes: largeCounts.nodes, edges: largeCounts.edges }, { nodes: 720, edges: 640 }));
  test("large graph repeated render does not multiply DOM", () => assert.deepEqual({ nodes: largeRepeated.nodes, edges: largeRepeated.edges }, { nodes: largeCounts.nodes, edges: largeCounts.edges }));
  test("large graph retains click interaction and semantics", () => { assert.equal(largeFocused.focus, 1); assert.deepEqual(largeFocused.semantic, largeBaseline); });
  test("large graph has no global horizontal overflow", () => assert.equal(largeCounts.overflow, false));
  const browserErrors = client.events.filter(event => event.method === "Runtime.exceptionThrown");
  test("tested browser flows have no uncaught exceptions", () => assert.equal(browserErrors.length, 0));

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
  client?.close();
  if (browserProcess && browserProcess.exitCode === null) {
    const exited = new Promise(resolve => browserProcess.once("exit", resolve));
    browserProcess.kill();
    await exited;
  }
  app.closeAllConnections?.();
  await new Promise(resolve => app.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
