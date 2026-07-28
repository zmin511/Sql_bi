import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";
import {
  referenceTypeParts,
  referenceRootMask,
  resolveReferenceTarget
} from "../src/core/references.js";

const { api } = loadProductionRuntime();

let passed = 0;

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    throw error;
  }
}

function row({
  id,
  internal,
  object = internal,
  title = object,
  type = "",
  parentId = null
}) {
  return {
    id,
    internal,
    object,
    title,
    type,
    parentId
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableRow(value) {
  if (!value) return null;

  return {
    id: value.id ?? null,
    internal: value.internal ?? null,
    object: value.object ?? null,
    title: value.title ?? null,
    type: value.type ?? null,
    parentId: value.parentId ?? null
  };
}

function stableResult(result) {
  return {
    status: result.status,
    target: stableRow(result.target),
    candidates: Array.from(result.candidates || [], stableRow),
    kind: result.kind ?? null,
    reason: result.reason ?? null,
    spec: result.spec
      ? {
          kind: result.spec.kind,
          shortName: result.spec.shortName,
          fullType: result.spec.fullType
        }
      : null,
    method: result.method ?? null,
    resolvedTarget: stableRow(result.resolvedTarget)
  };
}

function importRows(rows) {
  api.importRows(rows.map(item => ({ ...item })));
}

function compareResolution(name, {
  rows,
  field,
  chain = [],
  maxDepth = 5
}) {
  test(name, () => {
    importRows(rows);
    api.setReferenceDepthForTest(maxDepth);

    const production = stableResult(
      api.resolveReferenceTarget(clone(field), {
        chain: clone(chain),
        maxDepth
      })
    );

    const core = stableResult(
      resolveReferenceTarget(clone(field), {
        rows: clone(rows),
        chain: clone(chain),
        maxDepth
      })
    );

    assert.deepEqual(core, production);
  });
}

test("referenceTypeParts matches production for supported and malformed values", () => {
  const values = [
    null,
    "",
    "Строка",
    "Документ.Заказ",
    "Справочник.Сотрудники",
    "Перечисление.ВидыОплаты",
    " Справочник . Сотрудники ",
    "Справочник.Сотрудники; Перечисление.ВидыОплаты",
    "Справочник.Сотрудники;Справочник.Сотрудники",
    "Справочник.",
    "Справочник.Сотрудники; Строка"
  ];

  for (const value of values) {
    assert.deepEqual(
      clone(referenceTypeParts(value)),
      clone(api.referenceTypeParts(value))
    );
  }
});

test("referenceRootMask matches production technical root policy", () => {
  const kinds = ["reference", "enum", "document", null];
  const names = [
    "_Reference1",
    "_Reference10X2",
    "_Reference10_VT1",
    "_Enum2",
    "_Enum2X1",
    "_Document1",
    "_InfoRg1",
    "Справочник",
    "",
    null
  ];

  for (const kind of kinds) {
    const productionMask = api.referenceRootMask(kind);
    const coreMask = referenceRootMask(kind);

    for (const name of names) {
      assert.equal(
        coreMask.test(String(name || "")),
        productionMask.test(String(name || ""))
      );
    }
  }
});

const referenceRoot = row({
  id: "reference-root",
  internal: "_Reference10",
  object: "Сотрудники",
  title: "Справочник.Сотрудники",
  type: "Справочник.Сотрудники"
});

const enumRoot = row({
  id: "enum-root",
  internal: "_Enum20",
  object: "ВидыОплаты",
  title: "Перечисление.ВидыОплаты",
  type: "Перечисление.ВидыОплаты"
});

compareResolution("resolves reference by exact business type", {
  rows: [referenceRoot],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    object: "Сотрудник",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("resolves enum by exact business type", {
  rows: [enumRoot],
  field: row({
    id: "field",
    internal: "_Fld2RRef",
    object: "Вид оплаты",
    type: "Перечисление.ВидыОплаты"
  })
});

compareResolution("resolves by exact short object name", {
  rows: [
    {
      ...referenceRoot,
      type: ""
    }
  ],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("resolves by title containing full type", {
  rows: [
    {
      ...referenceRoot,
      object: "Другое",
      type: "",
      title: "Корень (Справочник.Сотрудники)"
    }
  ],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("fails closed for missing business type", {
  rows: [referenceRoot],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Строка"
  })
});

compareResolution("fails closed for multiple business types", {
  rows: [referenceRoot, enumRoot],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники; Перечисление.ВидыОплаты"
  })
});

compareResolution("reports missing root kind", {
  rows: [],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("fails closed for duplicate exact targets", {
  rows: [
    referenceRoot,
    {
      ...referenceRoot,
      id: "reference-root-2"
    }
  ],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("returns diagnostic candidates without first-match fallback", {
  rows: [
    {
      ...referenceRoot,
      object: "Сотрудники Архив",
      title: "Архив сотрудников",
      type: ""
    }
  ],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("rejects nontechnical display root", {
  rows: [
    row({
      id: "display-root",
      internal: "Сотрудники",
      object: "Сотрудники",
      type: "Справочник.Сотрудники"
    })
  ],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  })
});

compareResolution("blocks cycle by repeated target table", {
  rows: [referenceRoot],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  }),
  chain: [
    {
      refInternal: "_PreviousRRef",
      targetTable: "_Reference10",
      targetKind: "reference"
    }
  ]
});

compareResolution("blocks target when maximum depth is reached", {
  rows: [referenceRoot],
  field: row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  }),
  chain: [
    {
      refInternal: "_PreviousRRef",
      targetTable: "_Reference99",
      targetKind: "reference"
    }
  ],
  maxDepth: 1
});

test("resolution is deterministic across repeated calls", () => {
  const rows = [referenceRoot];
  const field = row({
    id: "field",
    internal: "_Fld1RRef",
    type: "Справочник.Сотрудники"
  });

  importRows(rows);
  api.setReferenceDepthForTest(5);

  const firstProduction = stableResult(
    api.resolveReferenceTarget(clone(field), {
      chain: [],
      maxDepth: 5
    })
  );

  const secondProduction = stableResult(
    api.resolveReferenceTarget(clone(field), {
      chain: [],
      maxDepth: 5
    })
  );

  const firstCore = stableResult(
    resolveReferenceTarget(clone(field), {
      rows: clone(rows),
      chain: [],
      maxDepth: 5
    })
  );

  const secondCore = stableResult(
    resolveReferenceTarget(clone(field), {
      rows: clone(rows),
      chain: [],
      maxDepth: 5
    })
  );

  assert.deepEqual(firstProduction, secondProduction);
  assert.deepEqual(firstCore, secondCore);
  assert.deepEqual(firstCore, firstProduction);
});

console.log(`${passed} reference resolution parity tests passed`);