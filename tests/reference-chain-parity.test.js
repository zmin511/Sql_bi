import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";
import {
  validateJoinChain,
  detectReferenceCycle,
  referenceChainSignature,
  buildSyntheticReferenceMeta,
  createSyntheticReferenceId
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

function importRows(rows, depth = 5) {
  api.importRows(rows.map(item => ({ ...item })));
  api.setReferenceDepthForTest(depth);
}

function compareChain(name, {
  rows,
  chain,
  maxDepth = 5
}) {
  test(name, () => {
    importRows(rows, maxDepth);

    const production = clone(
      api.validateJoinChain(clone(chain))
    );

    const core = clone(
      validateJoinChain(clone(chain), {
        rows: clone(rows),
        maxDepth
      })
    );

    assert.deepEqual(core, production);
  });
}

const referenceRoot = row({
  id: "reference-root",
  internal: "_Reference10",
  object: "Сотрудники",
  type: "Справочник.Сотрудники"
});

const secondReferenceRoot = row({
  id: "reference-root-2",
  internal: "_Reference20",
  object: "Подразделения",
  type: "Справочник.Подразделения"
});

const enumRoot = row({
  id: "enum-root",
  internal: "_Enum30",
  object: "ВидыОплаты",
  type: "Перечисление.ВидыОплаты"
});

const referenceStep = {
  refInternal: "_Fld1RRef",
  targetTable: "_Reference10",
  targetKind: "reference",
  targetType: "Справочник.Сотрудники",
  resolutionMethod: "exact_type"
};

const secondReferenceStep = {
  refInternal: "_Fld2RRef",
  targetTable: "_Reference20",
  targetKind: "reference",
  targetType: "Справочник.Подразделения",
  resolutionMethod: "exact_type"
};

const enumStep = {
  refInternal: "_Fld3RRef",
  targetTable: "_Enum30",
  targetKind: "enum",
  targetType: "Перечисление.ВидыОплаты",
  resolutionMethod: "exact_type"
};

compareChain("rejects empty chain", {
  rows: [referenceRoot],
  chain: []
});

compareChain("accepts one-step reference chain", {
  rows: [referenceRoot],
  chain: [referenceStep]
});

compareChain("accepts one-step enum chain", {
  rows: [enumRoot],
  chain: [enumStep]
});

compareChain("accepts two-step reference chain", {
  rows: [referenceRoot, secondReferenceRoot],
  chain: [referenceStep, secondReferenceStep]
});

compareChain("rejects missing target kind", {
  rows: [referenceRoot],
  chain: [
    {
      refInternal: "_Fld1RRef",
      targetTable: "_Reference10"
    }
  ]
});

compareChain("rejects nontechnical target table", {
  rows: [referenceRoot],
  chain: [
    {
      refInternal: "_Fld1RRef",
      targetTable: "Сотрудники",
      targetKind: "reference"
    }
  ]
});

compareChain("rejects missing target root", {
  rows: [],
  chain: [referenceStep]
});

compareChain("rejects duplicate target root", {
  rows: [
    referenceRoot,
    {
      ...referenceRoot,
      id: "duplicate-root"
    }
  ],
  chain: [referenceStep]
});

compareChain("rejects repeated target cycle", {
  rows: [referenceRoot],
  chain: [referenceStep, referenceStep]
});

compareChain("accepts chain exactly at depth limit", {
  rows: [referenceRoot, secondReferenceRoot],
  chain: [referenceStep, secondReferenceStep],
  maxDepth: 2
});

compareChain("rejects chain above depth limit", {
  rows: [referenceRoot, secondReferenceRoot],
  chain: [referenceStep, secondReferenceStep],
  maxDepth: 1
});

compareChain("accepts five-step chain at production maximum", {
  rows: [
    referenceRoot,
    secondReferenceRoot,
    row({ id: "r3", internal: "_Reference30" }),
    row({ id: "r4", internal: "_Reference40" }),
    row({ id: "r5", internal: "_Reference50" })
  ],
  chain: [
    referenceStep,
    secondReferenceStep,
    { refInternal: "_Fld3RRef", targetTable: "_Reference30", targetKind: "reference" },
    { refInternal: "_Fld4RRef", targetTable: "_Reference40", targetKind: "reference" },
    { refInternal: "_Fld5RRef", targetTable: "_Reference50", targetKind: "reference" }
  ],
  maxDepth: 5
});

test("detectReferenceCycle follows repeated target-table policy", () => {
  assert.deepEqual(
    detectReferenceCycle([
      referenceStep,
      secondReferenceStep
    ]),
    {
      cycle: false,
      targetTable: null,
      reason: null
    }
  );

  assert.deepEqual(
    detectReferenceCycle([
      referenceStep,
      {
        ...referenceStep,
        refInternal: "_AnotherRRef"
      }
    ]),
    {
      cycle: true,
      targetTable: "_reference10",
      reason: "repeated_target"
    }
  );
});

test("referenceChainSignature is deterministic and order-sensitive", () => {
  const first = referenceChainSignature([
    referenceStep,
    secondReferenceStep
  ]);

  const second = referenceChainSignature([
    referenceStep,
    secondReferenceStep
  ]);

  const reversed = referenceChainSignature([
    secondReferenceStep,
    referenceStep
  ]);

  assert.equal(
    first,
    "_Fld1RRef->_Reference10/_Fld2RRef->_Reference20"
  );

  assert.equal(first, second);
  assert.notEqual(first, reversed);
  assert.equal(
    referenceChainSignature([
      {
        refInternal: "",
        targetTable: "_Reference10"
      }
    ]),
    null
  );
});

test("buildSyntheticReferenceMeta returns production-shaped serializable metadata", () => {
  const meta = buildSyntheticReferenceMeta({
    baseTopId: "document-field",
    chain: [referenceStep],
    tableInternal: "_Reference10",
    field: {
      object: "Наименование",
      title: "Наименование",
      internal: "_Description",
      type: "Строка"
    },
    displayPath: "Сотрудник.Наименование",
    displayPrefix: "Сотрудник.Наименование"
  });

  assert.deepEqual(meta, {
    baseTopId: "document-field",
    chain: [referenceStep],
    tableInternal: "_Reference10",
    field: {
      object: "Наименование",
      title: "Наименование",
      internal: "_Description",
      type: "Строка"
    },
    displayPath: "Сотрудник.Наименование",
    displayPrefix: "Сотрудник.Наименование"
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(meta)),
    meta
  );

  assert.notEqual(meta.chain, referenceStep);
});

test("createSyntheticReferenceId matches production format", () => {
  const input = {
    baseTopId: "document-field",
    chainLength: 2,
    tableInternal: "_Reference20",
    fieldInternal: "_Description"
  };

  const core = createSyntheticReferenceId(input);
  const production = api.synthId(
    input.baseTopId,
    input.chainLength,
    input.tableInternal,
    input.fieldInternal
  );

  assert.equal(
    core,
    "s:document-field:2:_Reference20:_Description"
  );

  assert.equal(core, production);

  assert.equal(
    createSyntheticReferenceId({
      ...input,
      baseTopId: ""
    }),
    null
  );
});

test("chain validation is deterministic across repeated calls", () => {
  const rows = [referenceRoot, secondReferenceRoot];
  const chain = [referenceStep, secondReferenceStep];

  importRows(rows, 5);

  const firstProduction = clone(
    api.validateJoinChain(clone(chain))
  );

  const secondProduction = clone(
    api.validateJoinChain(clone(chain))
  );

  const firstCore = clone(
    validateJoinChain(clone(chain), {
      rows: clone(rows),
      maxDepth: 5
    })
  );

  const secondCore = clone(
    validateJoinChain(clone(chain), {
      rows: clone(rows),
      maxDepth: 5
    })
  );

  assert.deepEqual(firstProduction, secondProduction);
  assert.deepEqual(firstCore, secondCore);
  assert.deepEqual(firstCore, firstProduction);
});

console.log(`${passed} reference chain parity and core-contract tests passed`);