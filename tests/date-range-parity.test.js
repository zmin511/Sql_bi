import assert from "node:assert/strict";
import {
  buildManualDateRange as coreBuildManualDateRange,
  buildRelativeDateRange as coreBuildRelativeDateRange
} from "../src/core/dates.js";
import {
  loadProductionRuntime
} from "./helpers/load-production-runtime.js";

const { api } = loadProductionRuntime("index.html");

const expression =
  "DATEADD(YEAR, -2000, T.[_Date_Time])";

function normalized(value) {
  return JSON.parse(JSON.stringify(value));
}

const relativeCases = [
  {
    name: "empty relative period",
    settings: {}
  },
  {
    name: "past months and days",
    settings: {
      pastMonths: 2,
      pastDays: 10
    }
  },
  {
    name: "future months and days",
    settings: {
      futureMonths: 1,
      futureDays: 5
    }
  },
  {
    name: "combined past and future period",
    settings: {
      pastMonths: 3,
      pastDays: 2,
      futureMonths: 1,
      futureDays: 7
    }
  },
  {
    name: "invalid values normalize to zero",
    settings: {
      pastMonths: -2,
      pastDays: "not-a-number",
      futureMonths: 0,
      futureDays: null
    }
  },
  {
    name: "fractional and excessive values are bounded",
    settings: {
      pastMonths: 2.9,
      pastDays: 40000,
      futureMonths: 1500,
      futureDays: 3.8
    }
  }
];

const manualCases = [
  {
    name: "empty manual period",
    from: "",
    to: ""
  },
  {
    name: "manual lower boundary only",
    from: "2026-07-01",
    to: ""
  },
  {
    name: "manual upper boundary only",
    from: "",
    to: "2026-07-21"
  },
  {
    name: "manual inclusive date range",
    from: "2026-07-01",
    to: "2026-07-21"
  },
  {
    name: "valid leap day",
    from: "2024-02-29",
    to: "2024-02-29"
  },
  {
    name: "invalid date format",
    from: "01.07.2026",
    to: "2026-07-21"
  },
  {
    name: "impossible calendar date",
    from: "2026-02-30",
    to: "2026-03-01"
  },
  {
    name: "reversed manual range",
    from: "2026-07-22",
    to: "2026-07-21"
  }
];

let passed = 0;

for (const item of relativeCases) {
  const productionResult = normalized(
    api.buildRelativeDateRange(
      item.settings,
      expression
    )
  );

  const coreResult = normalized(
    coreBuildRelativeDateRange(
      item.settings,
      expression
    )
  );

  assert.deepEqual(
    coreResult,
    productionResult,
    `Relative period mismatch: ${item.name}`
  );

  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

for (const item of manualCases) {
  const productionResult = normalized(
    api.buildManualDateRange(
      expression,
      item.from,
      item.to
    )
  );

  const coreResult = normalized(
    coreBuildManualDateRange(
      expression,
      item.from,
      item.to
    )
  );

  assert.deepEqual(
    coreResult,
    productionResult,
    `Manual period mismatch: ${item.name}`
  );

  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} date range parity cases passed`);