import { describe, test, expect } from "bun:test";
import { ok, err } from "neverthrow";
import { parseResults } from "./parse";
import { buildYearlyTable, calculateYearly, CPP_MAX_BASE, EI_MAX } from "./yearly";
import { PAY_PERIODS, type PayrollConfig, type PayrollResult, type PayrollService } from "./types";

// ── Mock service ────────────────────────────────────────────

const mockService = (responses: Record<string, PayrollResult>): PayrollService => ({
  calculate: async (config, _headless) => {
    const key = config.cppMaxedOut ? "maxed" : "active";
    const result = responses[key];
    if (!result) return err(`mock: no response for key "${key}"`);
    return ok(result);
  },
});

const BASE_CONFIG: PayrollConfig = {
  province: "Ontario",
  annualSalary: 100_000,
  payPeriod: "Semi-monthly (24 pay periods a year)",
  year: 2026,
  rrspMatchPercent: 4,
  rrspUnmatchedPercent: 0,
  cppMaxedOut: false,
  eiMaxedOut: false,
};

// Realistic CRA-like results for $100k Ontario semi-monthly
const ACTIVE_RESULT: PayrollResult = {
  grossIncome: 4166.67,
  rrspMatched: 166.67,
  rrspUnmatched: 0,
  rrspEmployer: 166.67,
  federalTax: 521.11,
  provincialTax: 264.24,
  cpp: 249.16,
  cpp2: 0,
  ei: 67.92,
  totalDeductions: 1269.10,
  net: 2897.57,
};

const MAXED_RESULT: PayrollResult = {
  ...ACTIVE_RESULT,
  cpp: 0,
  cpp2: 0,
  ei: 0,
  federalTax: 540.00,
  provincialTax: 275.00,
  totalDeductions: 815.00,
  net: 3351.67,
};

// ── parseResults tests ──────────────────────────────────────

describe("parseResults", () => {
  const sampleText = `
Salary or wages income 4,166.67
Federal tax deduction 521.11
Provincial tax deduction 264.24
CPP deductions 249.16
CPP2 deductions 0.00
EI deductions 67.92
Total deductions 1,102.43
Net amount 3,064.24
`;

  test("parses all fields from CRA results text", () => {
    const result = parseResults(sampleText, BASE_CONFIG, 24);
    expect(result.isOk()).toBe(true);
    const r = result._unsafeUnwrap();
    expect(r.grossIncome).toBe(4166.67);
    expect(r.federalTax).toBe(521.11);
    expect(r.provincialTax).toBe(264.24);
    expect(r.cpp).toBe(249.16);
    expect(r.cpp2).toBe(0);
    expect(r.ei).toBe(67.92);
    expect(r.totalDeductions).toBe(1102.43);
    expect(r.net).toBe(3064.24);
  });

  test("calculates RRSP amounts from config", () => {
    const result = parseResults(sampleText, BASE_CONFIG, 24);
    const r = result._unsafeUnwrap();
    // 100000 * 0.04 / 24 = 166.67
    expect(r.rrspMatched).toBeCloseTo(166.67, 2);
    expect(r.rrspEmployer).toBeCloseTo(166.67, 2);
    expect(r.rrspUnmatched).toBe(0);
  });

  test("calculates unmatched RRSP from config", () => {
    const config = { ...BASE_CONFIG, rrspUnmatchedPercent: 2 };
    const result = parseResults(sampleText, config, 24);
    const r = result._unsafeUnwrap();
    // 100000 * 0.04 / 24 = 166.67
    expect(r.rrspMatched).toBeCloseTo(166.67, 2);
    // 100000 * 0.02 / 24 = 83.33
    expect(r.rrspUnmatched).toBeCloseTo(83.33, 2);
    // employer only matches the matched portion
    expect(r.rrspEmployer).toBeCloseTo(166.67, 2);
  });

  test("handles zero RRSP", () => {
    const config = { ...BASE_CONFIG, rrspMatchPercent: 0, rrspUnmatchedPercent: 0 };
    const result = parseResults(sampleText, config, 24);
    const r = result._unsafeUnwrap();
    expect(r.rrspMatched).toBe(0);
    expect(r.rrspUnmatched).toBe(0);
    expect(r.rrspEmployer).toBe(0);
  });

  test("errors on $0 gross with non-zero salary", () => {
    const result = parseResults("nothing useful here", BASE_CONFIG, 24);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("Parsed $0 gross");
  });

  test("handles large salary with commas", () => {
    const text = `
Salary or wages income 10,958.33
Federal tax deduction 2,232.82
Provincial tax deduction 1,431.13
CPP deductions 669.42
CPP2 deductions 0.00
EI deductions 178.62
Total deductions 4,511.99
Net amount 6,446.34
`;
    const config = { ...BASE_CONFIG, annualSalary: 200000 };
    const result = parseResults(text, config, 24);
    const r = result._unsafeUnwrap();
    expect(r.grossIncome).toBe(10958.33);
    expect(r.federalTax).toBe(2232.82);
  });

  test("handles biweekly periods", () => {
    const result = parseResults(sampleText, {
      ...BASE_CONFIG,
      payPeriod: "Biweekly (26 pay periods a year)",
    }, 26);
    const r = result._unsafeUnwrap();
    // 100000 * 0.04 / 26 = 153.85
    expect(r.rrspMatched).toBeCloseTo(153.85, 2);
  });
});

// ── PAY_PERIODS tests ───────────────────────────────────────

describe("PAY_PERIODS", () => {
  test("semi-monthly is 24", () => {
    expect(PAY_PERIODS["Semi-monthly (24 pay periods a year)"]).toBe(24);
  });

  test("biweekly is 26", () => {
    expect(PAY_PERIODS["Biweekly (26 pay periods a year)"]).toBe(26);
  });

  test("weekly is 52", () => {
    expect(PAY_PERIODS["Weekly (52 pay periods a year)"]).toBe(52);
  });

  test("monthly is 12", () => {
    expect(PAY_PERIODS["Monthly (12 pay periods a year)"]).toBe(12);
  });
});

// ── buildYearlyTable tests ──────────────────────────────────

describe("buildYearlyTable", () => {
  test("produces correct number of rows", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    expect(result.rows.length).toBe(24);
  });

  test("cumulative CPP never exceeds max", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    const lastRow = result.rows[result.rows.length - 1];
    expect(lastRow.cumulativeCpp).toBeLessThanOrEqual(CPP_MAX_BASE);
    expect(lastRow.cumulativeEi).toBeLessThanOrEqual(EI_MAX);
  });

  test("total CPP matches max when enough periods", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    expect(result.totals.cpp).toBeCloseTo(CPP_MAX_BASE, 2);
  });

  test("total EI matches max when enough periods", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    expect(result.totals.ei).toBeCloseTo(EI_MAX, 2);
  });

  test("CPP maxes out at correct period", () => {
    // 4230.45 / 249.16 = 16.98, so period 17 is partial, 18+ is 0
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    const firstZeroCpp = result.rows.find(r => r.cpp === 0);
    expect(firstZeroCpp).toBeDefined();
    expect(firstZeroCpp!.period).toBe(18);
  });

  test("EI maxes out at correct period", () => {
    // 1123.07 / 67.92 = 16.54, so period 17 is partial, 18+ is 0
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    const firstZeroEi = result.rows.find(r => r.ei === 0);
    expect(firstZeroEi).toBeDefined();
    expect(firstZeroEi!.period).toBe(18);
  });

  test("partial period has correct remaining amount", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    // Period 17: CPP remaining = 4230.45 - (16 * 249.16) = 4230.45 - 3986.56 = 243.89
    const partialRow = result.rows[16]; // period 17 (0-indexed)
    expect(partialRow.cpp).toBeCloseTo(4230.45 - 16 * 249.16, 2);
  });

  test("taxes switch to maxed rates after all maxed", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    const lastRow = result.rows[result.rows.length - 1];
    expect(lastRow.federalTax).toBe(MAXED_RESULT.federalTax);
    expect(lastRow.provincialTax).toBe(MAXED_RESULT.provincialTax);
  });

  test("taxes use active rates before maxed", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    expect(result.rows[0].federalTax).toBe(ACTIVE_RESULT.federalTax);
    expect(result.rows[0].provincialTax).toBe(ACTIVE_RESULT.provincialTax);
  });

  test("net pay increases after CPP/EI maxed", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    const firstRow = result.rows[0];
    const lastRow = result.rows[result.rows.length - 1];
    expect(lastRow.netPay).toBeGreaterThan(firstRow.netPay);
  });

  test("gross income is constant across all periods", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    for (const row of result.rows) {
      expect(row.grossIncome).toBe(ACTIVE_RESULT.grossIncome);
    }
  });

  test("totals sum correctly", () => {
    const result = buildYearlyTable(ACTIVE_RESULT, MAXED_RESULT, BASE_CONFIG, 24);
    const sumGross = result.rows.reduce((s, r) => s + r.grossIncome, 0);
    expect(result.totals.grossIncome).toBeCloseTo(sumGross, 2);
    const sumNet = result.rows.reduce((s, r) => s + r.netPay, 0);
    expect(result.totals.netPay).toBeCloseTo(sumNet, 2);
  });

  test("unmatched RRSP flows through to rows and totals", () => {
    const activeWithUnmatched: PayrollResult = {
      ...ACTIVE_RESULT,
      rrspUnmatched: 83.33,
    };
    const maxedWithUnmatched: PayrollResult = {
      ...MAXED_RESULT,
      rrspUnmatched: 83.33,
    };
    const config = { ...BASE_CONFIG, rrspUnmatchedPercent: 2 };
    const result = buildYearlyTable(activeWithUnmatched, maxedWithUnmatched, config, 24);
    expect(result.rows[0].rrspUnmatched).toBe(83.33);
    expect(result.rows[0].rrspMatched).toBe(166.67);
    expect(result.totals.rrspUnmatched).toBeCloseTo(83.33 * 24, 2);
    expect(result.totals.rrspMatched).toBeCloseTo(166.67 * 24, 2);
    // employer only matches the matched portion
    expect(result.totals.rrspEmployer).toBeCloseTo(166.67 * 24, 2);
  });

  test("high earner maxes out early", () => {
    // $200k semi-monthly: CPP 669.42/period, maxes at period 7
    const highActive: PayrollResult = {
      ...ACTIVE_RESULT,
      grossIncome: 10958.33,
      cpp: 669.42,
      ei: 178.62,
    };
    const highMaxed: PayrollResult = { ...MAXED_RESULT, grossIncome: 10958.33 };
    const highConfig = { ...BASE_CONFIG, annualSalary: 200000 };

    const result = buildYearlyTable(highActive, highMaxed, highConfig, 24);
    // 4230.45 / 669.42 = 6.32 → period 7 partial, 8+ zero
    const firstZero = result.rows.find(r => r.cpp === 0);
    expect(firstZero!.period).toBe(8);
    expect(result.totals.cpp).toBeCloseTo(CPP_MAX_BASE, 2);
  });
});

// ── calculateYearly with mock service ───────────────────────

describe("calculateYearly", () => {
  test("calls service twice (active + maxed)", async () => {
    let calls: string[] = [];
    const service: PayrollService = {
      calculate: async (config, _headless) => {
        const key = config.cppMaxedOut ? "maxed" : "active";
        calls.push(key);
        return ok(key === "maxed" ? MAXED_RESULT : ACTIVE_RESULT);
      },
    };

    const result = await calculateYearly(service, BASE_CONFIG, false);
    expect(result.isOk()).toBe(true);
    expect(calls).toContain("active");
    expect(calls).toContain("maxed");
    expect(calls.length).toBe(2);
  });

  test("returns error on invalid pay period", async () => {
    const service = mockService({ active: ACTIVE_RESULT, maxed: MAXED_RESULT });
    const config = { ...BASE_CONFIG, payPeriod: "Every full moon" };
    const result = await calculateYearly(service, config, false);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("Unknown pay period");
  });

  test("propagates service errors", async () => {
    const failService: PayrollService = {
      calculate: async () => err("CRA is down"),
    };
    const result = await calculateYearly(failService, BASE_CONFIG, false);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("CRA is down");
  });

  test("produces valid yearly result", async () => {
    const service = mockService({ active: ACTIVE_RESULT, maxed: MAXED_RESULT });
    const result = await calculateYearly(service, BASE_CONFIG, false);
    expect(result.isOk()).toBe(true);
    const { rows, totals } = result._unsafeUnwrap();
    expect(rows.length).toBe(24);
    expect(totals.grossIncome).toBeCloseTo(100000, -1);
    expect(totals.cpp).toBeCloseTo(CPP_MAX_BASE, 2);
    expect(totals.ei).toBeCloseTo(EI_MAX, 2);
  });
});

// ── Config validation ───────────────────────────────────────

describe("config validation", () => {
  test("rejects unknown pay period via service", async () => {
    const service = mockService({ active: ACTIVE_RESULT, maxed: MAXED_RESULT });
    const config = { ...BASE_CONFIG, payPeriod: "Every full moon" };
    const yearly = await calculateYearly(service, config, false);
    expect(yearly.isErr()).toBe(true);
  });
});
