import { describe, test, expect } from "bun:test";
import {
  buildJsonSingle,
  buildJsonTable,
  buildJsonMonthTable,
  buildJsonAnnual,
  buildJsonMonthly,
  buildJsonOutput,
} from "./views/json";
import { buildYearlyTable } from "./yearly";
import { groupByMonth } from "./monthly";
import type { PayrollConfig, PayrollResult } from "./types";

const CONFIG: PayrollConfig = {
  province: "Ontario",
  annualSalary: 100_000,
  payPeriod: "Semi-monthly (24 pay periods a year)",
  year: 2026,
  rrspMatchPercent: 4,
  rrspUnmatchedPercent: 2,
  cppMaxedOut: false,
  eiMaxedOut: false,
};

const ACTIVE: PayrollResult = {
  grossIncome: 4166.67,
  rrspMatched: 166.67,
  rrspUnmatched: 83.33,
  rrspEmployer: 166.67,
  federalTax: 521.11,
  provincialTax: 264.24,
  cpp: 249.16,
  cpp2: 0,
  ei: 67.92,
  totalDeductions: 1269.10,
  net: 2897.57,
};

const MAXED: PayrollResult = {
  ...ACTIVE,
  cpp: 0,
  cpp2: 0,
  ei: 0,
  federalTax: 540.0,
  provincialTax: 275.0,
  totalDeductions: 815.0,
  net: 3351.67,
};

// ── buildJsonSingle ─────────────────────────────────────────

describe("buildJsonSingle", () => {
  test("returns mode 'single' with config and result", () => {
    const output = buildJsonSingle(CONFIG, ACTIVE);
    expect(output.mode).toBe("single");
    expect(output.config).toEqual(CONFIG);
    expect(output.result).toEqual(ACTIVE);
  });

  test("output is valid JSON-serializable", () => {
    const output = buildJsonSingle(CONFIG, ACTIVE);
    const parsed = JSON.parse(JSON.stringify(output));
    expect(parsed.mode).toBe("single");
    expect(parsed.result.grossIncome).toBe(4166.67);
  });
});

// ── buildJsonTable ──────────────────────────────────────────

describe("buildJsonTable", () => {
  test("returns mode 'table' with all pay period rows", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonTable(CONFIG, yearly);
    expect(output.mode).toBe("table");
    expect(output.yearly.rows).toHaveLength(24);
    expect(output.yearly.totals.grossIncome).toBeGreaterThan(0);
  });

  test("totals match row sums", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonTable(CONFIG, yearly);
    const sumGross = output.yearly.rows.reduce((s, r) => s + r.grossIncome, 0);
    expect(Math.round(sumGross * 100) / 100).toBe(output.yearly.totals.grossIncome);
  });
});

// ── buildJsonMonthTable ─────────────────────────────────────

describe("buildJsonMonthTable", () => {
  test("returns mode 'month-table' with 12 months", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const output = buildJsonMonthTable(CONFIG, monthly);
    expect(output.mode).toBe("month-table");
    expect(output.monthly.rows).toHaveLength(12);
    expect(output.monthly.rows[0].month).toBe("Jan");
    expect(output.monthly.rows[11].month).toBe("Dec");
  });
});

// ── buildJsonAnnual ─────────────────────────────────────────

describe("buildJsonAnnual", () => {
  test("returns mode 'annual' with totals", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonAnnual(CONFIG, yearly.totals);
    expect(output.mode).toBe("annual");
    expect(output.totals.grossIncome).toBe(yearly.totals.grossIncome);
    expect(output.totals.netPay).toBe(yearly.totals.netPay);
  });
});

// ── buildJsonMonthly ────────────────────────────────────────

describe("buildJsonMonthly", () => {
  test("returns mode 'monthly' with averages divided by 12", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonMonthly(CONFIG, yearly.totals);
    expect(output.mode).toBe("monthly");
    expect(output.averages.grossIncome).toBeCloseTo(yearly.totals.grossIncome / 12, 1);
    expect(output.averages.netPay).toBeCloseTo(yearly.totals.netPay / 12, 1);
  });

  test("averages are rounded to 2 decimal places", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonMonthly(CONFIG, yearly.totals);
    for (const key of Object.keys(output.averages) as (keyof typeof output.averages)[]) {
      const val = output.averages[key];
      expect(val).toBe(Math.round(val * 100) / 100);
    }
  });
});

// ── buildJsonOutput (dispatcher) ────────────────────────────

describe("buildJsonOutput", () => {
  test("dispatches single mode", () => {
    const output = buildJsonOutput("single", CONFIG, { single: ACTIVE });
    expect(output.mode).toBe("single");
  });

  test("dispatches table mode", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonOutput("table", CONFIG, { yearly });
    expect(output.mode).toBe("table");
  });

  test("dispatches month-table mode", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const output = buildJsonOutput("month-table", CONFIG, { monthly });
    expect(output.mode).toBe("month-table");
  });

  test("dispatches annual mode", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonOutput("annual", CONFIG, { yearly });
    expect(output.mode).toBe("annual");
  });

  test("dispatches monthly mode", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = buildJsonOutput("monthly", CONFIG, { yearly });
    expect(output.mode).toBe("monthly");
  });

  test("all modes produce valid JSON", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);

    const modes = [
      buildJsonOutput("single", CONFIG, { single: ACTIVE }),
      buildJsonOutput("table", CONFIG, { yearly }),
      buildJsonOutput("month-table", CONFIG, { monthly }),
      buildJsonOutput("annual", CONFIG, { yearly }),
      buildJsonOutput("monthly", CONFIG, { yearly }),
    ];

    for (const output of modes) {
      const json = JSON.stringify(output);
      const parsed = JSON.parse(json);
      expect(parsed.mode).toBeTruthy();
      expect(parsed.config.province).toBe("Ontario");
    }
  });
});
