import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { CdpClient, listenServer, closeServer, launchBrowserPage, cleanupAttempt } from "./helpers/browser-launch-layer.mjs";

const marker = "__LOCAL13B_BROWSER_ARRAY_BUFFER_REJECTION__";
const parserAlertFragment = "Unsupported ZIP file";
const counterClassification = Object.freeze({
  attempts: "TEST-SIDE",
  reads: "DIRECT",
  controlledErrors: "DIRECT",
  unhandledRejections: "DIRECT",
  successfulImports: "INFERRED",
  parserReached: "INFERRED"
});

function assertLifecycleCounters(name, actual, expected) {
  assert.deepEqual(actual, expected, `${name} lifecycle counters must match the real dispatches, reads, controlled errors, and confirmed state transitions.`);
}

const instrumentationAnchor = "    // init\n    renderTree(); renderSQL();";
const instrumentation = `    window.__SQLBI_IMPORT_BROWSER_TEST__ = Object.freeze({
      semantic: () => ({
        rows: state.rows.map(row => ({ id: row.id, parentId: row.parentId, internal: row.internal, object: row.object, title: row.title, type: row.type })),
        rootIds: state.roots.map(row => row.id),
        fieldIds: state.rows.filter(row => row.parentId).map(row => row.id),
        labels: state.rows.map(row => row.title || row.object),
        selectedIds: Object.keys(state.selected).filter(id => state.selected[id]).sort(),
        filters: { boolFilters: state.boolFilters, relationMode: state.relationMode },
        period: { periodFieldId: state.periodFieldId, periodMode: state.periodMode, dateFrom: state.dateFrom, dateTo: state.dateTo },
        queryPlan: state.queryPlan, sql: state.queryResult && state.queryResult.sql || "", graphView: state.queryGraph
      })
    });
`;
const sourceHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
if (sourceHtml.split(instrumentationAnchor).length - 1 !== 1) throw new Error("Expected one production instrumentation anchor.");
const html = sourceHtml.replace(instrumentationAnchor, `${instrumentation}${instrumentationAnchor}`).replace(/<\/body>\s*<\/html>\s*$/, `<script>
window.__local13bRejections=[];
window.__local13bAlerts=[];
window.alert=message => window.__local13bAlerts.push(String(message));
window.addEventListener("unhandledrejection", event => window.__local13bRejections.push(String(event.reason && event.reason.message || event.reason)));
</script></body></html>`);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
});
const sockets = new Set();
server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
const suiteContext = { startedAt: Date.now(), currentPhase: "server", browserPid: null, debugPort: null, currentUrl: "", abortController: new AbortController() };
let attempt;

async function evaluate(expression) {
  const result = await attempt.pageClient.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

try {
  const port = await listenServer(server);
  suiteContext.currentUrl = `http://127.0.0.1:${port}/index.html`;
  suiteContext.currentPhase = "launch";
  attempt = await launchBrowserPage({ CdpClient, pageUrl: suiteContext.currentUrl, suiteContext, maxAttemptsPerBrowser: 2 });
  suiteContext.browserPid = attempt.browserProcess.pid;
  suiteContext.debugPort = attempt.debugPort;
  suiteContext.currentPhase = "read-rejection";
  const before = await evaluate(`({sql:document.getElementById("sql").value,inputValue:document.getElementById("xlsx").value})`);

  await evaluate(`(() => {
    const input=document.getElementById("xlsx");
    Object.defineProperty(input,"files",{configurable:true,value:[{name:"fixture.xlsx",arrayBuffer(){return Promise.reject(new Error(${JSON.stringify(marker)}));}}]});
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));

  const result = await evaluate(`({rejections:window.__local13bRejections.slice(),sql:document.getElementById("sql").value,inputValue:document.getElementById("xlsx").value})`);
  assert.deepEqual(result.rejections, [], "Production structure import must not cause an unhandled rejection in a real browser.");
  assert.deepEqual({ sql: result.sql, inputValue: result.inputValue }, before, "A failed read must preserve the rendered state and reset the structure input.");

  suiteContext.currentPhase = "valid-xlsx-import";
  const validImport = await evaluate(`(async () => {
    const input = document.getElementById("xlsx");
    const XLSX = window.XLSX;
    if (!XLSX || typeof XLSX.write !== "function") throw new Error("Embedded SheetJS is unavailable.");
    const headers = ["Объекты", "Внутреннее имя", "Тип", "Уровень"];
    const rows = [["Table A", "_Document901", "", 1], ["Field A", "_Fld901", "string", 2]];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TDSheet");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    let reads = 0, attempts = 0;
    const alertsBefore = window.__local13bAlerts.length;
    const file = { name: "structure-a-browser.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer() { reads += 1; return Promise.resolve(bytes); } };
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    attempts += 1; input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { hasXlsx: true, byteLength: bytes.byteLength, reads, attempts, alertsBefore, alerts: window.__local13bAlerts.slice(), inputValue: input.value, bodyText: document.body.innerText, semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic(), rejections: window.__local13bRejections.slice() };
  })()`);
  assert.equal(validImport.hasXlsx, true, "Production page must expose embedded SheetJS.");
  assert.ok(validImport.byteLength > 0, "Browser Structure A XLSX buffer must not be empty.");
  assert.equal(validImport.reads, 1, "Browser Structure A File-like object must be read once.");
  assert.equal(validImport.inputValue, "", "Browser structure input must reset after valid import.");
  assert.deepEqual(validImport.rejections, [], "Valid browser XLSX import must not cause unhandled rejections.");
  assert.match(validImport.bodyText, /Table A/, "Browser UI must render Structure A table label.");
  assert.match(validImport.bodyText, /Field A/, "Browser UI must render Structure A field label.");
  assert.ok(validImport.semantic.rows.some(row => row.internal === "_Document901"), "Runtime state must contain Structure A table ID.");
  assert.ok(validImport.semantic.rows.some(row => row.internal === "_Fld901"), "Runtime state must contain Structure A field ID.");
  assertLifecycleCounters("Valid A", {
    attempts: validImport.attempts,
    reads: validImport.reads,
    controlledErrors: validImport.alerts.length - validImport.alertsBefore,
    unhandledRejections: validImport.rejections.length,
    successfulImports: validImport.semantic.rows.some(row => row.internal === "_Document901") && validImport.semantic.rows.some(row => row.internal === "_Fld901") ? 1 : 0
  }, { attempts: 1, reads: 1, controlledErrors: 0, unhandledRejections: 0, successfulImports: 1 });

  suiteContext.currentPhase = "populated-read-rejection";
  const failedImport = await evaluate(`(async () => {
    const input = document.getElementById("xlsx");
    const marker = "__LOCAL13C1B2B1_BROWSER_READ_REJECTION__";
    const before = { bodyText: document.body.innerText, sql: document.getElementById("sql").value, alerts: window.__local13bAlerts.slice(), rejections: window.__local13bRejections.slice(), semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic() };
    let reads = 0, attempts = 0;
    const file = { name: "structure-a-read-rejection.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer() { reads += 1; return Promise.reject(new Error(marker)); } };
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    attempts += 1; input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { marker, reads, attempts, before, after: { bodyText: document.body.innerText, sql: document.getElementById("sql").value, inputValue: input.value, alerts: window.__local13bAlerts.slice(), rejections: window.__local13bRejections.slice(), semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic() } };
  })()`);
  assert.equal(failedImport.reads, 1, "Populated browser read-failure file must be read once.");
  assert.equal(failedImport.after.alerts.length, failedImport.before.alerts.length + 1, "Populated read failure must emit exactly one controlled alert.");
  assert.ok(failedImport.after.alerts.at(-1).includes(failedImport.marker), "Controlled browser alert must contain the exact read marker.");
  assert.deepEqual(failedImport.after.rejections, [], "Populated read failure must not cause unhandled rejections.");
  assert.equal(failedImport.after.inputValue, "", "Browser structure input must reset after populated read failure.");
  assert.equal(failedImport.after.bodyText, failedImport.before.bodyText, "Populated browser UI state must be preserved after read failure.");
  assert.equal(failedImport.after.sql, failedImport.before.sql, "Generated SQL state must be preserved after read failure.");
  assert.match(failedImport.after.bodyText, /Table A/, "Structure A table label must remain after failed read.");
  assert.match(failedImport.after.bodyText, /Field A/, "Structure A field label must remain after failed read.");
  assert.deepEqual(failedImport.after.semantic, failedImport.before.semantic, "Failed read must not create an additional runtime state transition.");
  assertLifecycleCounters("A to read failure", {
    attempts: validImport.attempts + failedImport.attempts,
    reads: validImport.reads + failedImport.reads,
    controlledErrors: failedImport.after.alerts.length - failedImport.before.alerts.length,
    unhandledRejections: failedImport.after.rejections.length,
    successfulImports: 1
  }, { attempts: 2, reads: 2, controlledErrors: 1, unhandledRejections: 0, successfulImports: 1 });

  const retryImport = await evaluate(`(async () => {
    const input = document.getElementById("xlsx"), XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet([["Объекты", "Внутреннее имя", "Тип", "Уровень"], ["Table B", "_Document902", "", 1], ["Field B", "_Fld902", "string", 2]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "TDSheet");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    let reads = 0, attempts = 0; const file = { name: "structure-b-retry.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer() { reads += 1; return Promise.resolve(bytes); } };
    const alertsBefore = window.__local13bAlerts.length;
    Object.defineProperty(input, "files", { configurable: true, value: [file] }); attempts += 1; input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { reads, attempts, alertsBefore, alerts: window.__local13bAlerts.slice(), inputValue: input.value, bodyText: document.body.innerText, semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic(), rejections: window.__local13bRejections.slice() };
  })()`);
  assert.equal(retryImport.reads, 1, "Browser retry Structure B must be read once.");
  assert.equal(retryImport.inputValue, "", "Browser input must reset after Structure B retry.");
  assert.equal(retryImport.alerts.length, retryImport.alertsBefore, "Valid Structure B retry must not add a controlled alert.");
  assert.deepEqual(retryImport.rejections, [], "Valid Structure B retry must not cause unhandled rejections.");
  assert.match(retryImport.bodyText, /Table B/, "Browser UI must render Structure B table label.");
  assert.match(retryImport.bodyText, /Field B/, "Browser UI must render Structure B field label.");
  assert.doesNotMatch(retryImport.bodyText, /Table A/, "Browser UI must remove Structure A table label after retry.");
  assert.doesNotMatch(retryImport.bodyText, /Field A/, "Browser UI must remove Structure A field label after retry.");
  assert.ok(retryImport.semantic.rows.some(row => row.internal === "_Document902"), "Runtime state must contain Structure B table ID.");
  assert.ok(retryImport.semantic.rows.some(row => row.internal === "_Fld902"), "Runtime state must contain Structure B field ID.");
  assert.ok(!retryImport.semantic.rows.some(row => row.internal === "_Document901" || row.internal === "_Fld901"), "Runtime state must remove Structure A IDs after Structure B import.");
  assertLifecycleCounters("A to read failure to B", {
    attempts: validImport.attempts + failedImport.attempts + retryImport.attempts,
    reads: validImport.reads + failedImport.reads + retryImport.reads,
    controlledErrors: failedImport.after.alerts.length - failedImport.before.alerts.length + (retryImport.alerts.length - retryImport.alertsBefore),
    unhandledRejections: retryImport.rejections.length,
    successfulImports: 2
  }, { attempts: 3, reads: 3, controlledErrors: 1, unhandledRejections: 0, successfulImports: 2 });

  const parserFailure = await evaluate(`(async () => {
    const input = document.getElementById("xlsx");
    const before = { bodyText: document.body.innerText, sql: document.getElementById("sql").value, alerts: window.__local13bAlerts.slice(), semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic() };
    const bytes = new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]).buffer;
    let reads = 0, attempts = 0; const file = { name: "malformed-browser-parser.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer() { reads += 1; return Promise.resolve(bytes); } };
    Object.defineProperty(input, "files", { configurable: true, value: [file] }); attempts += 1; input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { bytes: bytes.byteLength, reads, attempts, before, after: { bodyText: document.body.innerText, sql: document.getElementById("sql").value, inputValue: input.value, alerts: window.__local13bAlerts.slice(), rejections: window.__local13bRejections.slice(), semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic() } };
  })()`);
  assert.ok(parserFailure.bytes > 0, "Malformed browser parser fixture must have bytes.");
  assert.equal(parserFailure.reads, 1, "Malformed browser parser fixture must be read once.");
  assert.equal(parserFailure.after.alerts.length, parserFailure.before.alerts.length + 1, "Parser failure must emit exactly one controlled alert.");
  assert.ok(parserFailure.after.alerts.at(-1).includes(parserAlertFragment), "Parser controlled alert must contain the stable SheetJS parser fragment.");
  assert.deepEqual(parserFailure.after.rejections, [], "Parser failure must not cause unhandled rejections.");
  assert.equal(parserFailure.after.inputValue, "", "Browser input must reset after parser failure.");
  assert.equal(parserFailure.after.bodyText, parserFailure.before.bodyText, "Structure B UI state must be preserved after parser failure.");
  assert.equal(parserFailure.after.sql, parserFailure.before.sql, "SQL state must be preserved after parser failure.");
  assert.match(parserFailure.after.bodyText, /Table B/, "Structure B table label must remain after parser failure.");
  assert.match(parserFailure.after.bodyText, /Field B/, "Structure B field label must remain after parser failure.");
  assert.deepEqual(parserFailure.after.semantic, parserFailure.before.semantic, "Parser failure must not create an additional runtime state transition.");
  assertLifecycleCounters("B to parser failure", {
    attempts: retryImport.attempts + parserFailure.attempts,
    reads: retryImport.reads + parserFailure.reads,
    controlledErrors: parserFailure.after.alerts.length - parserFailure.before.alerts.length,
    unhandledRejections: parserFailure.after.rejections.length,
    successfulImports: 1,
    parserReached: parserFailure.reads === 1 && parserFailure.bytes > 0 && parserFailure.after.alerts.at(-1).includes(parserAlertFragment) && parserFailure.after.rejections.length === 0
  }, { attempts: 2, reads: 2, controlledErrors: 1, unhandledRejections: 0, successfulImports: 1, parserReached: true });

  const parserRetry = await evaluate(`(async () => {
    const input = document.getElementById("xlsx"), XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet([["Объекты", "Внутреннее имя", "Тип", "Уровень"], ["Table A", "_Document901", "", 1], ["Field A", "_Fld901", "string", 2]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "TDSheet"); const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    let reads = 0, attempts = 0; const file = { name: "structure-a-parser-retry.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer() { reads += 1; return Promise.resolve(bytes); } };
    const alertsBefore = window.__local13bAlerts.length;
    Object.defineProperty(input, "files", { configurable: true, value: [file] }); attempts += 1; input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 100));
    return { reads, attempts, alertsBefore, alerts: window.__local13bAlerts.slice(), inputValue: input.value, bodyText: document.body.innerText, semantic: window.__SQLBI_IMPORT_BROWSER_TEST__.semantic(), rejections: window.__local13bRejections.slice() };
  })()`);
  assert.equal(parserRetry.reads, 1, "Parser retry Structure A must be read once.");
  assert.equal(parserRetry.inputValue, "", "Input must reset after parser retry.");
  assert.equal(parserRetry.alerts.length, parserRetry.alertsBefore, "Valid parser retry must not add an alert.");
  assert.deepEqual(parserRetry.rejections, [], "Valid parser retry must not cause unhandled rejections.");
  assert.match(parserRetry.bodyText, /Table A/, "Parser retry must render Structure A table label.");
  assert.match(parserRetry.bodyText, /Field A/, "Parser retry must render Structure A field label.");
  assert.doesNotMatch(parserRetry.bodyText, /Table B/, "Parser retry must remove Structure B table label.");
  assert.doesNotMatch(parserRetry.bodyText, /Field B/, "Parser retry must remove Structure B field label.");
  assert.ok(parserRetry.semantic.rows.some(row => row.internal === "_Document901" || row.internal === "_Fld901"), "Parser retry must create the expected Structure A runtime transition.");
  assert.ok(!parserRetry.semantic.rows.some(row => row.internal === "_Document902" || row.internal === "_Fld902"), "Parser retry must remove Structure B runtime IDs.");
  assertLifecycleCounters("B to parser failure to A", {
    attempts: retryImport.attempts + parserFailure.attempts + parserRetry.attempts,
    reads: retryImport.reads + parserFailure.reads + parserRetry.reads,
    controlledErrors: parserRetry.alerts.length - parserFailure.before.alerts.length,
    unhandledRejections: parserRetry.rejections.length,
    successfulImports: 2,
    parserReached: parserFailure.reads === 1 && parserFailure.bytes > 0 && parserFailure.after.alerts.at(-1).includes(parserAlertFragment) && parserFailure.after.rejections.length === 0
  }, { attempts: 3, reads: 3, controlledErrors: 1, unhandledRejections: 0, successfulImports: 2, parserReached: true });
} finally {
  if (attempt) await cleanupAttempt(attempt, suiteContext);
  await closeServer(server, sockets);
}
