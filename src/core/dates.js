const PERIOD_LIMITS = Object.freeze({
  months: 1200,
  days: 36500
});

export function sqlDateExpr(alias, column, type = "") {
  const expr = qualifiedColumn(alias, column);
  if (!expr) return null;
  const isDate =
    /_Date_Time$/i.test(column) ||
    column === "_Date_Time" ||
    /дата/i.test(String(type)) ||
    /date|datetime/i.test(String(type).toLowerCase());

  return isDate
    ? `DATEADD(YEAR, -2000, ${expr})`
    : expr;
}

export function relativeDateBoundary(months, days, direction) {
  let expr = "GETDATE()";
  const monthCount = Math.max(0, Number(months || 0)) || 0;
  const dayCount = Math.max(0, Number(days || 0)) || 0;
  const sign = direction === "future" ? 1 : -1;

  if (monthCount > 0) {
    expr = `DATEADD(MONTH, ${sign * monthCount}, ${expr})`;
  }

  if (dayCount > 0) {
    expr = `DATEADD(DAY, ${sign * dayCount}, ${expr})`;
  }

  return expr;
}

function safePeriodValue(value, maxValue) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return Math.min(Math.trunc(numeric), maxValue);
}

function normalizedPeriodSettings(settings = {}) {
  return {
    pastMonths: safePeriodValue(
      settings.pastMonths,
      PERIOD_LIMITS.months
    ),
    pastDays: safePeriodValue(
      settings.pastDays,
      PERIOD_LIMITS.days
    ),
    futureMonths: safePeriodValue(
      settings.futureMonths,
      PERIOD_LIMITS.months
    ),
    futureDays: safePeriodValue(
      settings.futureDays,
      PERIOD_LIMITS.days
    )
  };
}

function offsetFromToday(months, days, direction) {
  let expression = "CAST(GETDATE() AS date)";
  const sign = direction === "future" ? 1 : -1;

  if (months > 0) {
    expression =
      `DATEADD(MONTH, ${sign * months}, ${expression})`;
  }

  if (days > 0) {
    expression =
      `DATEADD(DAY, ${sign * days}, ${expression})`;
  }

  return expression;
}

function periodPart(months, days, direction) {
  const parts = [];

  if (months) {
    parts.push(`${months} мес.`);
  }

  if (days) {
    parts.push(`${days} дн.`);
  }

  if (!parts.length) {
    return "сегодня";
  }

  return direction === "past"
    ? `${parts.join(" и ")} назад`
    : `${parts.join(" и ")} вперёд`;
}

export function buildRelativeDateRange(
  settings,
  dateExpression
) {
  const values = normalizedPeriodSettings(settings);
  const hasPast =
    values.pastMonths > 0 ||
    values.pastDays > 0;
  const hasFuture =
    values.futureMonths > 0 ||
    values.futureDays > 0;

  if (!hasPast && !hasFuture) {
    return {
      active: false,
      ...values,
      lower: null,
      upperExclusive: null,
      conditions: [],
      description:
        "Период не применяется: все значения равны нулю."
    };
  }

  const today = "CAST(GETDATE() AS date)";

  const lower = hasPast
    ? offsetFromToday(
        values.pastMonths,
        values.pastDays,
        "past"
      )
    : today;

  const futureEnd = hasFuture
    ? offsetFromToday(
        values.futureMonths,
        values.futureDays,
        "future"
      )
    : today;

  const upperExclusive =
    `DATEADD(DAY, 1, ${futureEnd})`;

  const description = hasPast && hasFuture
    ? `Период: ${periodPart(
        values.pastMonths,
        values.pastDays,
        "past"
      )} — ${periodPart(
        values.futureMonths,
        values.futureDays,
        "future"
      )}, включая конечный день.`
    : hasPast
      ? `Период: ${periodPart(
          values.pastMonths,
          values.pastDays,
          "past"
        )}, включая сегодняшний день.`
      : `Период: сегодня и ${periodPart(
          values.futureMonths,
          values.futureDays,
          "future"
        )}.`;

  return {
    active: true,
    ...values,
    lower,
    upperExclusive,
    conditions: [
      `${dateExpression} >= ${lower}`,
      `${dateExpression} < ${upperExclusive}`
    ],
    description
  };
}

function parseIsoCalendarDate(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return {
      valid: true,
      empty: true,
      value: null,
      reason: "empty"
    };
  }

  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

  if (!match) {
    return {
      valid: false,
      empty: false,
      value: null,
      reason: "format"
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return {
      valid: false,
      empty: false,
      value: null,
      reason: "value"
    };
  }

  const leap =
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);

  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ][month - 1];

  if (day > daysInMonth) {
    return {
      valid: false,
      empty: false,
      value: null,
      reason: "value"
    };
  }

  return {
    valid: true,
    empty: false,
    value: `${match[1]}-${match[2]}-${match[3]}`,
    reason: "ok"
  };
}

export function buildManualDateRange(
  dateExpression,
  dateFrom,
  dateTo
) {
  const from = parseIsoCalendarDate(dateFrom);
  const to = parseIsoCalendarDate(dateTo);
  const diagnostics = [];

  if (!from.valid) {
    diagnostics.push(
      "Дата «с» некорректна: требуется реальная календарная дата в формате YYYY-MM-DD."
    );
  }

  if (!to.valid) {
    diagnostics.push(
      "Дата «по» некорректна: требуется реальная календарная дата в формате YYYY-MM-DD."
    );
  }

  if (!from.valid || !to.valid) {
    diagnostics.push(
      "Условие ручного периода намеренно не сформировано."
    );

    return {
      active: false,
      requested: true,
      valid: false,
      conditions: [],
      diagnostics,
      from,
      to
    };
  }

  if (from.empty && to.empty) {
    return {
      active: false,
      requested: false,
      valid: true,
      conditions: [],
      diagnostics,
      description:
        "Ручной период не применяется: обе календарные границы пусты.",
      from,
      to
    };
  }

  if (
    !from.empty &&
    !to.empty &&
    from.value > to.value
  ) {
    diagnostics.push(
      "Дата «с» позже даты «по»: перевёрнутый диапазон не сформирован."
    );
    diagnostics.push(
      "Условие ручного периода намеренно не сформировано."
    );

    return {
      active: false,
      requested: true,
      valid: false,
      conditions: [],
      diagnostics,
      from,
      to
    };
  }

  const conditions = [];

  if (!from.empty) {
    conditions.push(
      `${dateExpression} >= CAST('${from.value}' AS date)`
    );
  }

  if (!to.empty) {
    conditions.push(
      `${dateExpression} < DATEADD(DAY, 1, CAST('${to.value}' AS date))`
    );
  }

  return {
    active: true,
    requested: true,
    valid: true,
    conditions,
    diagnostics,
    from,
    to,
    description: from.empty
      ? `Ручной период: по ${to.value} включительно.`
      : to.empty
        ? `Ручной период: с ${from.value}.`
        : `Ручной период: с ${from.value} по ${to.value} включительно.`
  };
}
import { qualifiedColumn } from "./sqlIdentifiers.js";
