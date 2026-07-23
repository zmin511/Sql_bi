import assert from "node:assert/strict";
import {
  parseNumericType as coreParseNumericType
} from "../src/core/casts.js";
import {
  loadProductionRuntime
} from "./helpers/load-production-runtime.js";

const { api } = loadProductionRuntime("index.html");

const cases = [
  {
    name: "1C integer preserves precision",
    type: "Число 15.0",
    expected: {
      matched: true,
      precision: 15,
      scale: 0,
      unsigned: false,
      reason: "ok",
      composite: false
    }
  },
  {
    name: "1C unsigned fraction preserves scale",
    type: "Число +15.2",
    expected: {
      matched: true,
      precision: 15,
      scale: 2,
      unsigned: true,
      reason: "ok",
      composite: false
    }
  },
  {
    name: "decimal parentheses format",
    type: "decimal(38, 10)",
    expected: {
      matched: true,
      precision: 38,
      scale: 10,
      unsigned: false,
      reason: "ok",
      composite: false
    }
  },
  {
    name: "numeric dotted format",
    type: "numeric 12.3",
    expected: {
      matched: true,
      precision: 12,
      scale: 3,
      unsigned: false,
      reason: "ok",
      composite: false
    }
  },
  {
    name: "precision above SQL Server limit",
    type: "decimal(39, 0)",
    expected: {
      matched: false,
      precision: 39,
      scale: 0,
      unsigned: false,
      reason: "invalid_precision",
      composite: false
    }
  },
  {
    name: "scale above precision",
    type: "decimal(10, 11)",
    expected: {
      matched: false,
      precision: 10,
      scale: 11,
      unsigned: false,
      reason: "invalid_scale",
      composite: false
    }
  },
  {
    name: "unknown numeric format",
    type: "Число",
    expected: {
      matched: false,
      precision: null,
      scale: null,
      unsigned: false,
      reason: "unknown_numeric_format",
      composite: false
    }
  },
  {
    name: "composite numeric type",
    type: "Число 15.2; Строка 10",
    expected: {
      matched: false,
      precision: null,
      scale: null,
      unsigned: false,
      reason: "composite_type",
      composite: true
    }
  },
  {
    name: "non-numeric composite type",
    type: "Булево; Строка",
    expected: {
      matched: false,
      precision: null,
      scale: null,
      unsigned: false,
      reason: "not_numeric",
      composite: true
    }
  },
  {
    name: "ordinary non-numeric type",
    type: "Строка 100",
    expected: {
      matched: false,
      precision: null,
      scale: null,
      unsigned: false,
      reason: "not_numeric",
      composite: false
    }
  }
];

const fields = [
  "matched",
  "precision",
  "scale",
  "unsigned",
  "reason",
  "composite"
];

let passed = 0;

for (const item of cases) {
  const productionResult = api.parseNumericType(item.type);
  const coreResult = coreParseNumericType(item.type);

  for (const field of fields) {
    assert.equal(
      productionResult[field],
      item.expected[field],
      `Unexpected production ${field}: ${item.name}`
    );

    assert.equal(
      coreResult[field],
      productionResult[field],
      `Core/production ${field} mismatch: ${item.name}`
    );
  }

  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} numeric parity cases passed`);