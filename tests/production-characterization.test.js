import assert from "node:assert/strict";
import { loadProductionRuntime } from "./helpers/load-production-runtime.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assertSafeRange(range, expression) {
  assert.equal(range.active, true);
  assert.equal(range.conditions.length, 2);
  assert.equal(range.conditions[0], `${expression} >= ${range.lower}`);
  assert.equal(
    range.conditions[1],
    `${expression} < ${range.upperExclusive}`
  );
}

const runtime = loadProductionRuntime("index.html");
const { api, elements } = runtime;

test("production selectability rejects structural and parent nodes", () => {
  assert.equal(
    api.isSelectableField(
      { internal: "_Fld123" },
      { kind: "orig", hasOriginalChildren: false }
    ),
    true
  );

  assert.equal(
    api.isSelectableField(
      { internal: "_Document100" },
      { kind: "orig", hasOriginalChildren: false }
    ),
    false
  );

  assert.equal(
    api.isSelectableField(
      { internal: "_Fld123" },
      { kind: "orig", hasOriginalChildren: true }
    ),
    false
  );

  assert.equal(
    api.isSelectableField(
      { internal: "_Description" },
      { kind: "synth", hasOriginalChildren: true }
    ),
    true
  );
});

test("production numeric parser preserves precision and scale", () => {
  const oneCInteger = api.parseNumericType("Число 15.0");
  assert.equal(oneCInteger.matched, true);
  assert.equal(oneCInteger.precision, 15);
  assert.equal(oneCInteger.scale, 0);

  const oneCFraction = api.parseNumericType("Число +15.2");
  assert.equal(oneCFraction.matched, true);
  assert.equal(oneCFraction.precision, 15);
  assert.equal(oneCFraction.scale, 2);
  assert.equal(oneCFraction.unsigned, true);

  const decimal = api.parseNumericType("decimal(38, 10)");
  assert.equal(decimal.matched, true);
  assert.equal(decimal.precision, 38);
  assert.equal(decimal.scale, 10);

  const invalid = api.parseNumericType("decimal(39, 0)");
  assert.equal(invalid.matched, false);
  assert.equal(invalid.reason, "invalid_precision");
});

test("production relative periods always have two safe boundaries", () => {
  const expression = "DATEADD(YEAR, -2000, T.[_Date_Time])";

  const past = api.buildRelativeDateRange(
    {
      pastMonths: 2,
      pastDays: 10,
      futureMonths: 0,
      futureDays: 0
    },
    expression
  );

  assertSafeRange(past, expression);
  assert.match(past.lower, /DATEADD\(MONTH, -2,/);
  assert.match(past.lower, /DATEADD\(DAY, -10,/);
  assert.equal(
    past.upperExclusive,
    "DATEADD(DAY, 1, CAST(GETDATE() AS date))"
  );

  const future = api.buildRelativeDateRange(
    {
      pastMonths: 0,
      pastDays: 0,
      futureMonths: 1,
      futureDays: 5
    },
    expression
  );

  assertSafeRange(future, expression);
  assert.equal(future.lower, "CAST(GETDATE() AS date)");
  assert.match(future.upperExclusive, /^DATEADD\(DAY, 1, /);
});

test("production manual period validates dates and includes end day", () => {
  const expression = "DATEADD(YEAR, -2000, T.[_Date_Time])";

  const valid = api.buildManualDateRange(
    expression,
    "2026-07-01",
    "2026-07-21"
  );

  assert.equal(valid.active, true);
  assert.equal(valid.valid, true);
  assert.deepEqual(
    Array.from(valid.conditions),
    [
      `${expression} >= CAST('2026-07-01' AS date)`,
      `${expression} < DATEADD(DAY, 1, CAST('2026-07-21' AS date))`
    ]
  );

  const impossibleDate = api.buildManualDateRange(
    expression,
    "2026-02-30",
    "2026-03-01"
  );

  assert.equal(impossibleDate.active, false);
  assert.equal(impossibleDate.requested, true);
  assert.equal(impossibleDate.valid, false);
  assert.equal(impossibleDate.conditions.length, 0);

  const reversed = api.buildManualDateRange(
    expression,
    "2026-07-22",
    "2026-07-21"
  );

  assert.equal(reversed.active, false);
  assert.equal(reversed.valid, false);
  assert.equal(reversed.conditions.length, 0);
});

test("production selection context handles empty and manual modes", () => {
  const empty = api.resolveSelectionContext([]);
  assert.equal(empty.valid, false);
  assert.equal(empty.reason, "empty_selection");

  const manual = api.resolveSelectionContext(
    [],
    { manualFrom: "_Document100" }
  );

  assert.equal(manual.matched, true);
  assert.equal(manual.valid, true);
  assert.equal(manual.mode, "manual");
  assert.equal(manual.basePhysicalTable, "_Document100");

  const invalidManual = api.resolveSelectionContext(
    [],
    { manualFrom: "   " }
  );

  assert.equal(invalidManual.valid, false);
  assert.equal(invalidManual.reason, "invalid_manual_from");
});

test("production table-part resolver rejects absent input", () => {
  const result = api.resolveTablePartHeaderJoin(null);

  assert.equal(result.matched, false);
  assert.equal(result.unambiguous, false);
  assert.equal(result.reason, "not_table_part");
  assert.equal(result.headerTable, null);
  assert.equal(result.detailTable, null);
});

test("production renderSQL safely handles empty selection", () => {
  api.renderSQL();

  const sql = elements.get("sql");
  const selectedCount = elements.get("selCount");

  assert.ok(sql);
  assert.match(sql.value, /^-- /);
  assert.equal(selectedCount.textContent, 0);
});

let passed = 0;

for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`ok ${passed} - ${item.name}`);
}

console.log(`\n${passed} production characterization tests passed`);