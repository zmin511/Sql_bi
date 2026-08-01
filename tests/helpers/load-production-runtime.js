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

function instrumentApplicationSource(source) {
  const anchor = "\n  })();";
  const anchorIndex = source.lastIndexOf(anchor);
  if (anchorIndex < 0 || source.indexOf(anchor, anchorIndex + anchor.length) !== -1) throw new Error("Не найден единственный стабильный anchor завершения application IIFE.");
  const hooks = `\n    window.__SQLBI_TEST__ = { state, normalizeHeader, rowsFromTableObjects, importRows, buildTree, tableFor, isSelectableField, isReferenceField, getDocPrefix, isVTTableName, parseNumericType, castExpr, sqlDateExpr, buildRelativeDateRange, buildManualDateRange, resolveTablePartHeaderJoin, resolveSelectionContext, quoteIdentifier, qname, qualifiedColumn, stableAliasHash, fitColumnAlias, makeUniqueColumnAlias, outputAliasBase, referenceTypeParts, referenceRootMask, resolveReferenceTarget, validateJoinChain, chainHasTarget, chainText, synthId, renderTree, renderDiagnostics, makeRefChildrenFor, maxRefDepth, nodeData, buildCanonicalInputFromState, renderCanonicalSQL, renderQueryPlanPanel, buildQueryGraphModel, renderQueryGraph, clearQueryGraphFocus, setQueryGraphFocus, normalizeRelationshipStatus, relationshipStatusLabel, buildRelationshipDetails, createProjectSnapshot: () => requireCanonicalProjectApi().createProjectSnapshot(state, APP_VERSION), parseProjectSnapshot: input => requireCanonicalProjectApi().parseProjectSnapshot(input), applyProjectSnapshot, normalizeVisualizationSettings: value => requireCanonicalProjectApi().normalizeVisualizationSettings(value), createPowerQuery, createPowerQueryExport, renderSQL, setReferenceDepthForTest: value => { state.refDepth = value; } };\n`;
  return `${source.slice(0, anchorIndex)}${hooks}${source.slice(anchorIndex)}`;
}

export function loadProductionRuntime(options = "index.html") {
  const config = typeof options === "string" ? { indexPath: options, instrument: true } : { indexPath: "index.html", instrument: true, ...options };
  const indexPath = config.indexPath;
  const html = fs.readFileSync(indexPath, "utf8");
  let source = applicationScriptFromHtml(html);
  const canonicalSource = (html.match(/<!-- BEGIN GENERATED CANONICAL CORE -->\s*[\s\S]*?SQLBI_CANONICAL_MANIFEST [^\n]*\n([\s\S]*?)<!-- END GENERATED CANONICAL CORE -->/) || [])[1] || "";

  if (config.instrument) source = instrumentApplicationSource(source);
  const { sandbox: runtimeSandbox, elements: runtimeElements } = createBrowserSandbox();
  if (canonicalSource) vm.runInNewContext(canonicalSource, runtimeSandbox, { filename: indexPath, timeout: 5000 });
  vm.runInNewContext(source, runtimeSandbox, { filename: indexPath, timeout: 5000 });
  if (config.instrument && !runtimeSandbox.__SQLBI_TEST__) throw new Error("Инструментированный production runtime не опубликовал VM-only hooks.");
  if (!config.instrument && runtimeSandbox.__SQLBI_TEST__) throw new Error("Неинструментированный production runtime опубликовал test API.");
  return { api: runtimeSandbox.__SQLBI_TEST__ || null, elements: runtimeElements, html, source, canonicalCore: runtimeSandbox.SQLBICanonicalCore || null, runtime: runtimeSandbox };

}
