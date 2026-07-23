import fs from "node:fs";
import vm from "node:vm";

function createElement(id = "") {
  return {
    id,
    style: {},
    dataset: {},
    children: [],
    value: id === "sql"
      ? "-- Загрузите структуру и отметьте поля слева"
      : "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    files: [],
    className: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    removeChild(child) {
      this.children = this.children.filter(item => item !== child);
      return child;
    },
    remove() {},
    click() {},
    select() {},
    focus() {},
    setAttribute(name, value) {
      this[name] = value;
    },
    getAttribute(name) {
      return this[name] ?? null;
    },
    removeAttribute(name) {
      delete this[name];
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    }
  };
}

function createBrowserSandbox() {
  const elements = new Map();

  const document = {
    body: createElement("body"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    createElement(tag) {
      return createElement(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    execCommand() {
      return true;
    }
  };

  const sandbox = {
    console,
    document,
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    Blob: globalThis.Blob,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Date,
    Map,
    Set,
    RegExp,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Promise,
    Error,
    TypeError,
    URL: {
      createObjectURL() {
        return "blob:sql-bi-test";
      },
      revokeObjectURL() {}
    },
    alert() {},
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    queueMicrotask(callback) { callback(); },
    addEventListener() {}
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return { sandbox, elements };
}

function applicationScriptFromHtml(html) {
  const scripts = Array.from(
    html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    match => match[1]
  );

  if (scripts.length < 2) {
    throw new Error("В index.html не найдены встроенные SheetJS и application script.");
  }

  return scripts.at(-1);
}

export function loadProductionRuntime(indexPath = "index.html") {
  const html = fs.readFileSync(indexPath, "utf8");
  let source = applicationScriptFromHtml(html);

  const diagnosticApiMarker = "window.__SQLBI_TEST__ = {";
  if (!source.includes(diagnosticApiMarker)) {
    throw new Error("В production HTML отсутствует диагностический API.");
  }

  // Expose selected non-public functions only in the VM copy used by tests.
  source = source.replace(
    diagnosticApiMarker,
    `${diagnosticApiMarker}
      normalizeHeader, rowsFromTableObjects, tableFor,`
  );

  const { sandbox, elements } = createBrowserSandbox();

  vm.runInNewContext(source, sandbox, {
    filename: indexPath,
    timeout: 5000
  });

  if (!sandbox.__SQLBI_TEST__) {
    throw new Error("Production runtime не опубликовал window.__SQLBI_TEST__.");
  }

  return {
    api: sandbox.__SQLBI_TEST__,
    elements,
    html,
    source
  };
}