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

  await evaluate(`(() => {
    const input=document.getElementById("xlsx");
    Object.defineProperty(input,"files",{configurable:true,value:[{name:"fixture.xlsx",arrayBuffer(){return Promise.reject(new Error(${JSON.stringify(marker)}));}}]});
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));

  const result = await evaluate(`({rejections:window.__local13bRejections.slice(),sql:document.getElementById("sql").value,inputValue:document.getElementById("xlsx").value})`);
  assert.deepEqual(result.rejections, [], "Production structure import must not cause an unhandled rejection in a real browser.");
} finally {
  if (attempt) await cleanupAttempt(attempt, suiteContext);
  await closeServer(server, sockets);
}
