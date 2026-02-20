import { describe, test, expect } from "bun:test";
import { periodsPerMonth, groupByMonth } from "./monthly";
import { buildYearlyTable } from "./yearly";
import type { PayrollConfig, PayrollResult } from "./types";

// ── periodsPerMonth ─────────────────────────────────────────

describe("periodsPerMonth", () => {
  test("semi-monthly is always 2 per month", () => {
    const result = periodsPerMonth(2026, "Semi-monthly (24 pay periods a year)", 24);
    expect(result).toEqual(Array.from({ length: 12 }, () => 2));
    expect(result.reduce((a, b) => a + b)).toBe(24);
  });

  test("monthly is always 1 per month", () => {
    const result = periodsPerMonth(2026, "Monthly (12 pay periods a year)", 12);
    expect(result).toEqual(Array.from({ length: 12 }, () => 1));
  });

  test("weekly (52) sums to 52", () => {
    const result = periodsPerMonth(2026, "Weekly (52 pay periods a year)", 52);
    expect(result.reduce((a, b) => a + b)).toBe(52);
    // Every month has at least 4
    for (const count of result) {
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(5);
    }
  });

  test("weekly (53) sums to 53", () => {
    const result = periodsPerMonth(2026, "Weekly (53 pay periods a year)", 53);
    expect(result.reduce((a, b) => a + b)).toBe(53);
  });

  test("biweekly (26) sums to 26", () => {
    const result = periodsPerMonth(2026, "Biweekly (26 pay periods a year)", 26);
    expect(result.reduce((a, b) => a + b)).toBe(26);
    // Most months have 2, some have 3
    for (const count of result) {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  test("biweekly (27) sums to 27", () => {
    const result = periodsPerMonth(2026, "Biweekly (27 pay periods a year)", 27);
    expect(result.reduce((a, b) => a + b)).toBe(27);
  });

  test("daily (240) sums to 240", () => {
    const result = periodsPerMonth(2026, "Daily (240 pay periods a year)", 240);
    expect(result.reduce((a, b) => a + b)).toBe(240);
    // Feb should have fewer weekdays than Jan/Mar
    expect(result[1]).toBeLessThan(result[0]);
  });

  test("daily weekdays vary by month", () => {
    const result = periodsPerMonth(2026, "Daily (240 pay periods a year)", 240);
    // Not all months are equal
    const unique = new Set(result);
    expect(unique.size).toBeGreaterThan(1);
  });

  test("unusual period (10) sums correctly", () => {
    const result = periodsPerMonth(2026, "(10 pay periods a year)", 10);
    expect(result.reduce((a, b) => a + b)).toBe(10);
  });

  test("unusual period (13) sums correctly", () => {
    const result = periodsPerMonth(2026, "(13 pay periods a year)", 13);
    expect(result.reduce((a, b) => a + b)).toBe(13);
  });

  test("different years produce different daily distributions", () => {
    const a = periodsPerMonth(2026, "Daily (240 pay periods a year)", 240);
    const b = periodsPerMonth(2027, "Daily (240 pay periods a year)", 240);
    // At least one month should differ
    expect(a).not.toEqual(b);
  });

  test("biweekly 3-paycheck months depend on year", () => {
    // 2026 and 2028 have different first Fridays, so distributions differ
    const a = periodsPerMonth(2026, "Biweekly (26 pay periods a year)", 26);
    const b = periodsPerMonth(2028, "Biweekly (26 pay periods a year)", 26);
    // Both sum to 26, but 3-paycheck months should shift
    expect(a.reduce((s, n) => s + n)).toBe(26);
    expect(b.reduce((s, n) => s + n)).toBe(26);
    expect(a).not.toEqual(b);
  });
});

// ── groupByMonth ────────────────────────────────────────────

describe("groupByMonth", () => {
  const CONFIG: PayrollConfig = {
    province: "Ontario",
    annualSalary: 100_000,
    payPeriod: "Semi-monthly (24 pay periods a year)",
    year: 2026,
    rrspMatchPercent: 4,
    rrspUnmatchedPercent: 0,
    cppMaxedOut: false,
    eiMaxedOut: false,
  };

  const ACTIVE: PayrollResult = {
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

  const MAXED: PayrollResult = {
    ...ACTIVE,
    cpp: 0, cpp2: 0, ei: 0,
    federalTax: 540.00, provincialTax: 275.00,
    totalDeductions: 815.00, net: 3351.67,
  };

  test("produces 12 monthly rows", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    expect(monthly.rows.length).toBe(12);
  });

  test("month names are correct", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    expect(monthly.rows.map(r => r.month)).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    );
  });

  test("semi-monthly: each month has equal gross (2 periods)", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    // All months should have gross = 2 * 4166.67
    for (const row of monthly.rows) {
      expect(row.grossIncome).toBeCloseTo(4166.67 * 2, 2);
    }
  });

  test("monthly totals match yearly totals", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const sumGross = monthly.rows.reduce((s, r) => s + r.grossIncome, 0);
    expect(sumGross).toBeCloseTo(monthly.totals.grossIncome, 2);
    const sumNet = monthly.rows.reduce((s, r) => s + r.netPay, 0);
    expect(sumNet).toBeCloseTo(monthly.totals.netPay, 2);
  });

  test("biweekly: 3-paycheck months have higher gross", () => {
    const biweeklyConfig = { ...CONFIG, payPeriod: "Biweekly (26 pay periods a year)" };
    const biweeklyActive = { ...ACTIVE, grossIncome: 3846.15 };
    const biweeklyMaxed = { ...MAXED, grossIncome: 3846.15 };
    const yearly = buildYearlyTable(biweeklyActive, biweeklyMaxed, biweeklyConfig, 26);
    const monthly = groupByMonth(yearly, 2026, biweeklyConfig.payPeriod, 26);

    const threePaycheckMonths = monthly.rows.filter(r => r.grossIncome > 3846.15 * 2.5);
    const twoPaycheckMonths = monthly.rows.filter(r => r.grossIncome < 3846.15 * 2.5);

    expect(threePaycheckMonths.length).toBeGreaterThan(0);
    expect(twoPaycheckMonths.length).toBeGreaterThan(0);
    // 3-paycheck months should have ~50% more gross than 2-paycheck months
    expect(threePaycheckMonths[0].grossIncome).toBeGreaterThan(twoPaycheckMonths[0].grossIncome);
  });

  test("CPP/EI maxout is visible in monthly view", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    // Later months should have lower CPP (maxed out)
    expect(monthly.rows[11].cpp).toBe(0);
    expect(monthly.rows[0].cpp).toBeGreaterThan(0);
  });
});
