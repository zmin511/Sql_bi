import assert from "node:assert/strict";
import {
  castExpr as coreCastExpr
} from "../src/core/casts.js";
import {
  loadProductionRuntime
} from "./helpers/load-production-runtime.js";

const { api } = loadProductionRuntime("index.html");

const cases = [
  {
    name: "1C integer uses decimal instead of int",
    column: "_Fld100",
    type: "Число 15.0",
    expected: "CAST(T.[_Fld100] AS decimal(15,0))",
    diagnostics: []
  },
  {
    name: "1C fraction preserves scale",
    column: "_Fld101",
    type: "Число +15.2",
    expected: "CAST(T.[_Fld101] AS decimal(15,2))",
    diagnostics: []
  },
  {
    name: "decimal parentheses preserves precision",
    column: "_Fld102",
    type: "decimal(38, 10)",
    expected: "CAST(T.[_Fld102] AS decimal(38,10))",
    diagnostics: []
  },
  {
    name: "numeric dotted format preserves scale",
    column: "_Fld103",
    type: "numeric 12.3",
    expected: "CAST(T.[_Fld103] AS decimal(12,3))",
    diagnostics: []
  },
  {
    name: "exact int remains int",
    column: "_Fld104",
    type: "int",
    expected: "CAST(T.[_Fld104] AS int)",
    diagnostics: []
  },
  {
    name: "exact bigint remains bigint",
    column: "_Fld105",
    type: "bigint",
    expected: "CAST(T.[_Fld105] AS bigint)",
    diagnostics: []
  },
  {
    name: "invalid precision is not converted",
    column: "_Fld106",
    type: "decimal(39, 0)",
    expected: "T.[_Fld106]",
    diagnostics: [
      "Количество: precision в типе «decimal(39, 0)» должен быть от 1 до 38; преобразование намеренно не применено."
    ]
  },
  {
    name: "invalid scale is not converted",
    column: "_Fld107",
    type: "decimal(10, 11)",
    expected: "T.[_Fld107]",
    diagnostics: [
      "Количество: scale в типе «decimal(10, 11)» должен быть от 0 до precision; преобразование намеренно не применено."
    ]
  },
  {
    name: "unknown numeric format is not converted",
    column: "_Fld108",
    type: "Число",
    expected: "T.[_Fld108]",
    diagnostics: [
      "Количество: неизвестный числовой формат «Число»; преобразование намеренно не применено."
    ]
  },
  {
    name: "composite numeric type is not converted",
    column: "_Fld109",
    type: "Число 15.2; Строка 10",
    expected: "T.[_Fld109]",
    diagnostics: [
      "Количество: составной неоднозначный тип «Число 15.2; Строка 10»; числовое преобразование намеренно не применено."
    ]
  },
  {
    name: "reference column keeps UUID priority",
    column: "_Fld110RRef",
    type: "decimal(15, 0)",
    expected: "CAST(T.[_Fld110RRef] AS uniqueidentifier)",
    diagnostics: []
  },
  {
    name: "boolean keeps boolean priority",
    column: "_Posted",
    type: "Булево",
    expected: "CAST(T.[_Posted] AS int)",
    diagnostics: []
  }
];

let passed = 0;

for (const item of cases) {
  const productionDiagnostics = [];
  const coreDiagnostics = [];

  const productionResult = api.castExpr(
    "T",
    item.column,
    item.type,
    productionDiagnostics,
    "Количество"
  );

  const coreResult = coreCastExpr(
    "T",
    item.column,
    item.type,
    coreDiagnostics,
    "Количество"
  );

  assert.equal(
    productionResult,
    item.expected,
    `Unexpected production expression: ${item.name}`
  );

  assert.equal(
    coreResult,
    productionResult,
    `Core/production expression mismatch: ${item.name}`
  );

  assert.deepEqual(
    productionDiagnostics,
    item.diagnostics,
    `Unexpected production diagnostics: ${item.name}`
  );

  assert.deepEqual(
    coreDiagnostics,
    productionDiagnostics,
    `Core/production diagnostics mismatch: ${item.name}`
  );

  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} numeric cast parity cases passed`);