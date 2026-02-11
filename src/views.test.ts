import { describe, test, expect } from "bun:test";
import { renderTable } from "./views/table";
import { renderMonthlyTable } from "./views/monthlyTable";
import { renderAnnual, renderMonthly } from "./views/summary";
import { renderSingleResult } from "./views/single";
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
  cpp: 0, cpp2: 0, ei: 0,
  federalTax: 540.00, provincialTax: 275.00,
  totalDeductions: 815.00, net: 3351.67,
};

const NO_RRSP_CONFIG: PayrollConfig = {
  ...CONFIG,
  rrspMatchPercent: 0,
  rrspUnmatchedPercent: 0,
};

const NO_RRSP_ACTIVE: PayrollResult = {
  ...ACTIVE,
  rrspMatched: 0, rrspUnmatched: 0, rrspEmployer: 0,
};

const NO_RRSP_MAXED: PayrollResult = {
  ...MAXED,
  rrspMatched: 0, rrspUnmatched: 0, rrspEmployer: 0,
};

// ── Per-period table ────────────────────────────────────────

describe("renderTable", () => {
  test("includes effective tax rate", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Ontario", 100_000, 6);
    expect(output).toContain("Effective tax rate:");
    expect(output).toMatch(/Effective tax rate: \d+\.\d%/);
  });

  test("tax rate is reasonable for $100k", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Ontario", 100_000, 6);
    // Extract the rate
    const match = output.match(/Effective tax rate: ([\d.]+)%/);
    expect(match).toBeTruthy();
    const rate = parseFloat(match![1]);
    // Should be between 20-40% for $100k Ontario
    expect(rate).toBeGreaterThan(20);
    expect(rate).toBeLessThan(40);
  });

  test("tax rate reflects totalDeductions / gross", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Ontario", 100_000, 6);
    const match = output.match(/Effective tax rate: ([\d.]+)%/);
    const rate = parseFloat(match![1]);
    const expected = (yearly.totals.totalDeductions / yearly.totals.grossIncome) * 100;
    expect(rate).toBeCloseTo(expected, 0);
  });

  test("includes RRSP summary when RRSP configured", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Ontario", 100_000, 6);
    expect(output).toContain("RRSP You:");
    expect(output).toContain("RRSP Er:");
    expect(output).toContain("RRSP Total (You + Er):");
    expect(output).toContain("matched:");
    expect(output).toContain("unmatched:");
  });

  test("omits RRSP columns when no RRSP", () => {
    const yearly = buildYearlyTable(NO_RRSP_ACTIVE, NO_RRSP_MAXED, NO_RRSP_CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Ontario", 100_000, 0);
    expect(output).not.toContain("RRSP You");
    expect(output).not.toContain("RRSP Er");
    expect(output).not.toContain("Take Home");
    expect(output).toContain("Effective tax rate:");
  });

  test("includes marginal tax rate for supported province/year", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Ontario", 100_000, 6);
    expect(output).toContain("Marginal tax rate:");
    expect(output).toContain("fed");
    expect(output).toContain("prov");
  });

  test("omits marginal rate for unsupported province", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderTable(yearly, 24, 2026, "Narnia", 100_000, 6);
    expect(output).not.toContain("Marginal tax rate:");
    expect(output).toContain("Effective tax rate:");
  });
});

// ── Monthly table ───────────────────────────────────────────

describe("renderMonthlyTable", () => {
  test("includes effective tax rate", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const output = renderMonthlyTable(monthly, 2026, "Ontario", 100_000, 6);
    expect(output).toContain("Effective tax rate:");
    expect(output).toMatch(/Effective tax rate: \d+\.\d%/);
  });

  test("tax rate matches per-period table", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const periodOutput = renderTable(yearly, 24, 2026, "Ontario", 100_000, 6);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const monthlyOutput = renderMonthlyTable(monthly, 2026, "Ontario", 100_000, 6);

    const periodRate = periodOutput.match(/Effective tax rate: ([\d.]+)%/)![1];
    const monthlyRate = monthlyOutput.match(/Effective tax rate: ([\d.]+)%/)![1];
    expect(periodRate).toBe(monthlyRate);
  });

  test("shows all 12 months", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const output = renderMonthlyTable(monthly, 2026, "Ontario", 100_000, 6);
    for (const m of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]) {
      expect(output).toContain(m);
    }
  });

  test("includes RRSP summary when RRSP configured", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, CONFIG.payPeriod, 24);
    const output = renderMonthlyTable(monthly, 2026, "Ontario", 100_000, 6);
    expect(output).toContain("RRSP You:");
    expect(output).toContain("RRSP Er:");
    expect(output).toContain("RRSP Total (You + Er):");
  });

  test("omits RRSP when no RRSP", () => {
    const yearly = buildYearlyTable(NO_RRSP_ACTIVE, NO_RRSP_MAXED, NO_RRSP_CONFIG, 24);
    const monthly = groupByMonth(yearly, 2026, NO_RRSP_CONFIG.payPeriod, 24);
    const output = renderMonthlyTable(monthly, 2026, "Ontario", 100_000, 0);
    expect(output).not.toContain("RRSP You");
    expect(output).toContain("Effective tax rate:");
  });
});

// ── Single result ───────────────────────────────────────────

describe("renderSingleResult", () => {
  test("shows matched and unmatched RRSP", () => {
    const output = renderSingleResult(ACTIVE);
    expect(output).toContain("RRSP (Matched):");
    expect(output).toContain("RRSP (Unmatched):");
    expect(output).toContain("RRSP (Employer):");
  });

  test("shows after-RRSP amount", () => {
    const output = renderSingleResult(ACTIVE);
    expect(output).toContain("(after RRSP):");
  });

  test("omits RRSP lines when zero", () => {
    const output = renderSingleResult(NO_RRSP_ACTIVE);
    expect(output).not.toContain("RRSP");
    expect(output).not.toContain("after RRSP");
  });
});

// ── Summary views ───────────────────────────────────────────

describe("renderAnnual", () => {
  test("shows annual totals with RRSP breakdown", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderAnnual(yearly.totals);
    expect(output).toContain("Annual Totals");
    expect(output).toContain("RRSP (Matched):");
    expect(output).toContain("RRSP (Unmatched):");
    expect(output).toContain("(after RRSP):");
  });
});

describe("renderMonthly", () => {
  test("shows monthly averages", () => {
    const yearly = buildYearlyTable(ACTIVE, MAXED, CONFIG, 24);
    const output = renderMonthly(yearly.totals);
    expect(output).toContain("Monthly Averages");
  });
});
