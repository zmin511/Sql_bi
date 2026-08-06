import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { CdpClient, listenServer, closeServer, launchBrowserPage, cleanupAttempt } from "./helpers/browser-launch-layer.mjs";

const marker = "__LOCAL13B_BROWSER_ARRAY_BUFFER_REJECTION__";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<\/body>\s*<\/html>\s*$/, `<script>
window.__local13bRejections=[];
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
    let reads = 0;
    const file = { name: "structure-a-browser.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer() { reads += 1; return Promise.resolve(bytes); } };
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { hasXlsx: true, byteLength: bytes.byteLength, reads, inputValue: input.value, bodyText: document.body.innerText, rejections: window.__local13bRejections.slice() };
  })()`);
  assert.equal(validImport.hasXlsx, true, "Production page must expose embedded SheetJS.");
  assert.ok(validImport.byteLength > 0, "Browser Structure A XLSX buffer must not be empty.");
  assert.equal(validImport.reads, 1, "Browser Structure A File-like object must be read once.");
  assert.equal(validImport.inputValue, "", "Browser structure input must reset after valid import.");
  assert.deepEqual(validImport.rejections, [], "Valid browser XLSX import must not cause unhandled rejections.");
  assert.match(validImport.bodyText, /Table A/, "Browser UI must render Structure A table label.");
  assert.match(validImport.bodyText, /Field A/, "Browser UI must render Structure A field label.");
} finally {
  if (attempt) await cleanupAttempt(attempt, suiteContext);
  await closeServer(server, sockets);
}
