import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { CdpClient, listenServer, closeServer, launchBrowserPage, cleanupAttempt } from "./helpers/browser-launch-layer.mjs";

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const unhandledInstrumentation = `<script>window.__sqlbiUnhandledRejections=[];window.addEventListener("unhandledrejection",event=>{window.__sqlbiUnhandledRejections.push(String(event.reason&&(event.reason.stack||event.reason.message||event.reason)));});</script>`;
const servedHtml = html.replace("</head>", `${unhandledInstrumentation}</head>`);
if (servedHtml === html) throw new Error("Unhandled-rejection instrumentation anchor is missing");
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-bi-typed-filters-"));
const app = http.createServer((request, response) => {
  if (request.url === "/" || request.url === "/index.html") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(servedHtml); }
  else { response.writeHead(404); response.end(); }
});
const sockets = new Set(); app.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
const context = { startedAt: Date.now(), currentPhase: "start", browserPid: null, debugPort: null, currentUrl: "", abortController: new AbortController() };
let attempt;
const events = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function value(client, expression) { const result = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed"); return result.result.value; }
async function waitFor(client, expression, expected = true, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await value(client, expression) === expected) return; await delay(25); } throw new Error(`Timed out: ${expression}`); }
async function loadProject(client, snapshot) { const body = JSON.stringify(JSON.stringify(snapshot)); await value(client, `(() => { const input=document.getElementById('projectFile'); const file=new File([${body}], 'typed-filter-fixture.sqlbi', {type:'application/json'}); Object.defineProperty(input,'files',{configurable:true,value:[file]}); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await waitFor(client, "document.getElementById('tree').innerHTML.length > 0"); const count=await value(client,"document.querySelectorAll('#tree input[type=checkbox]').length"); if(count<3) throw new Error(`project loaded without selectable fields: ${count}`); }
async function click(client, selector) { await value(client, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element) throw new Error('missing '+${JSON.stringify(selector)}); element.click(); return true; })()`); }
async function setSelect(client, selector, next) { await value(client, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); element.value=${JSON.stringify(next)}; element.dispatchEvent(new Event('change',{bubbles:true})); return element.value; })()`); }
async function setInput(client, selector, next) { await value(client, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); element.value=${JSON.stringify(next)}; element.dispatchEvent(new Event('change',{bubbles:true})); return element.value; })()`); }
function fixture() { return { kind:"sql-bi-project", formatVersion:1, structure:{rows:[{id:"doc",object:"Order",internal:"_Document100",parentId:null},{id:"text",object:"Name",title:"Name",internal:"_FldText",type:"string",parentId:"doc"},{id:"number",object:"Amount",title:"Amount",internal:"_FldNumber",type:"decimal(10,2)",parentId:"doc"},{id:"flag",object:"Posted",title:"Posted",internal:"_FldFlag",type:"bool",parentId:"doc"}]}, selection:{selected:{},boolFilters:{},filters:[]},query:{schema:"dbo"},view:{expanded:{doc:true}} }; }

try {
  context.currentPhase = "server"; const port = await listenServer(app); const pageUrl = `http://127.0.0.1:${port}/index.html`; context.currentUrl = pageUrl;
  attempt = await launchBrowserPage({ CdpClient, pageUrl, suiteContext: context, onDiagnostic: event => console.log(`Launch diagnostic: ${JSON.stringify(event)}`), operations:{stabilizationOptions:{healthExpression:"Boolean(document.getElementById('filterEditor') && document.getElementById('btn-add-filter'))"}} });
  const client = attempt.pageClient; context.browserPid = attempt.browserProcess.pid; context.debugPort = attempt.debugPort;
  client.events = events; // preserve CDP event stream for diagnostics
  await client.command("Runtime.enable"); await client.command("Log.enable");
  assert.equal(await value(client, "Array.isArray(window.__sqlbiUnhandledRejections)"), true, "test-side unhandled-rejection listener must be installed before the workflow");
  context.currentPhase = "load-and-select"; await loadProject(client, fixture());
  for (const name of ["Name", "Amount"]) await value(client, `(() => { const node=[...document.querySelectorAll('#tree .node')].find(item=>item.textContent.includes(${JSON.stringify(name)})); const input=node && node.querySelector('input[type=checkbox]'); if(!input) throw new Error('selectable field missing: '+${JSON.stringify(name)}); input.click(); return input.checked; })()`);
  await waitFor(client, "document.querySelectorAll('#tree input[type=checkbox]:checked').length", 2);
  context.currentPhase = "add-text-filter"; await click(client, "#btn-add-filter"); await setSelect(client, ".filter-row:nth-child(1) .filter-field", "text"); await setSelect(client, ".filter-row:nth-child(1) .filter-operator", "contains"); await setInput(client, ".filter-row:nth-child(1) .filter-value", "O'Brien");
  context.currentPhase = "add-number-filter"; await click(client, "#btn-add-filter"); await setSelect(client, ".filter-row:nth-child(2) .filter-field", "number"); await setSelect(client, ".filter-row:nth-child(2) .filter-operator", "gte"); await setInput(client, ".filter-row:nth-child(2) .filter-value", "10");
  await waitFor(client, "document.getElementById('sql').value.includes(\"O''Brien\") && document.getElementById('sql').value.includes('>= 10') && document.getElementById('sql').value.includes(' AND ')");
  const twoFiltersSql = await value(client, "document.getElementById('sql').value"); assert.match(twoFiltersSql, /O''Brien/); assert.match(twoFiltersSql, />= 10/);
  context.currentPhase = "edit"; await setInput(client, ".filter-row:nth-child(2) .filter-value", "20"); await waitFor(client, "document.getElementById('sql').value.includes('>= 20') && !document.getElementById('sql').value.includes('>= 10')");
  context.currentPhase = "remove"; await click(client, ".filter-row:nth-child(1) .filter-remove"); await waitFor(client, "document.querySelectorAll('.filter-row').length", 1); await waitFor(client, "document.getElementById('sql').value.includes('>= 20') && !document.getElementById('sql').value.includes(\"O''Brien\")");
  const beforeSave = await value(client, "document.getElementById('sql').value");
  context.currentPhase = "save"; await attempt.browserClient.command("Browser.setDownloadBehavior", { behavior:"allow", downloadPath:downloadDir, eventsEnabled:true }); await click(client, "#btn-save-project");
  const deadline = Date.now() + 10000; let saved; while (Date.now() < deadline) { const files = fs.readdirSync(downloadDir).filter(file => file.endsWith(".sqlbi")); if (files.length) { saved = path.join(downloadDir, files[0]); break; } await delay(50); } assert.ok(saved, "production Save control did not download a project");
  context.currentPhase = "reopen"; const content = fs.readFileSync(saved, "utf8"); await value(client, `(() => { const input=document.getElementById('projectFile'); const file=new File([${JSON.stringify(content)}], 'reopened.sqlbi', {type:'application/json'}); Object.defineProperty(input,'files',{configurable:true,value:[file]}); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(client, "document.querySelectorAll('.filter-row').length", 1); await waitFor(client, "document.getElementById('sql').value.includes('>= 20')");
  assert.equal(await value(client, "document.getElementById('sql').value"), beforeSave, "reopened SQL must equal saved SQL");
  const unhandled = await value(client, "window.__sqlbiUnhandledRejections");
  const unexpected = events.filter(event => event.method === "Runtime.exceptionThrown" || (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") || (event.method === "Log.entryAdded" && event.params.entry.level === "error"));
  assert.equal(unexpected.length, 0, JSON.stringify(unexpected)); assert.deepEqual(unhandled, []);
  console.log("browser typed-filter workflow passed (two typed filters, AND, edit, remove, save/reopen, diagnostics clean)");
} finally {
  if (attempt) await cleanupAttempt(attempt, context);
  await closeServer(app, sockets);
  fs.rmSync(downloadDir, { recursive:true, force:true });
}
