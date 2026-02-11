import { describe, test, expect, afterEach } from "bun:test";
import { calculatePayroll } from "./cra";
import { setVerbose } from "./browser";
import type { PayrollConfig } from "./types";

setVerbose(true);

const HEADLESS = false;

const BASE: PayrollConfig = {
  province: "Ontario",
  annualSalary: 100_000,
  payPeriod: "Semi-monthly (24 pay periods a year)",
  year: 2026,
  rrspMatchPercent: 0,
  rrspUnmatchedPercent: 0,
  cppMaxedOut: false,
  eiMaxedOut: false,
};

const cfg = (o: Partial<PayrollConfig> = {}): PayrollConfig => ({ ...BASE, ...o });

const unwrap = (result: Awaited<ReturnType<typeof calculatePayroll>>) => {
  if (result.isErr()) {
    expect.unreachable(`Expected Ok but got Err: ${result.error}`);
  }
  return result.value;
};

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 1000));
});

// ── Pure validation (no browser) ────────────────────────────

describe("config validation", () => {
  test("rejects unknown pay period", async () => {
    const result = await calculatePayroll(cfg({ payPeriod: "Every full moon" }), HEADLESS);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("Unknown pay period");
  });
});

// ── Integration tests (hit CRA) ────────────────────────────

describe("CRA integration", () => {
  test("basic salary — Ontario $100k", async () => {
    const r = unwrap(await calculatePayroll(cfg(), HEADLESS));

    expect(r.grossIncome).toBe(4166.67);
    expect(r.net).toBeGreaterThan(0);
    expect(r.net).toBeLessThan(r.grossIncome);
    expect(r.federalTax).toBeGreaterThan(0);
    expect(r.provincialTax).toBeGreaterThan(0);
    expect(r.cpp).toBeGreaterThan(0);
    expect(r.ei).toBeGreaterThan(0);
    // Total deductions = sum of individual deductions
    expect(r.totalDeductions).toBeCloseTo(
      r.federalTax + r.provincialTax + r.cpp + r.cpp2 + r.ei, 2
    );
    // Net = gross - deductions
    expect(r.grossIncome - r.totalDeductions).toBeCloseTo(r.net, 2);
  }, 10_000);

  test("CPP/EI maxed — zero CPP/EI deductions, only taxes remain", async () => {
    const r = unwrap(await calculatePayroll(cfg({ cppMaxedOut: true, eiMaxedOut: true }), HEADLESS));

    expect(r.cpp).toBe(0);
    expect(r.cpp2).toBe(0);
    expect(r.ei).toBe(0);
    expect(r.totalDeductions).toBe(r.federalTax + r.provincialTax);
    expect(r.net).toBeGreaterThan(3000);
  }, 10_000);

  test("RRSP contributions reduce taxes vs base case", async () => {
    const r = unwrap(await calculatePayroll(cfg({ rrspMatchPercent: 4 }), HEADLESS));

    expect(r.rrspMatched).toBeCloseTo(166.67, 2);
    expect(r.rrspEmployer).toBeCloseTo(166.67, 2);
    // Base case without RRSP: federal ~585, provincial ~289
    // RRSP reduces taxable income, so taxes should be noticeably lower
    expect(r.federalTax).toBeLessThan(560);
    expect(r.provincialTax).toBeLessThan(280);
  }, 10_000);

  test("Alberta has different provincial tax than Ontario", async () => {
    const r = unwrap(await calculatePayroll(cfg({ province: "Alberta" }), HEADLESS));

    expect(r.grossIncome).toBe(4166.67);
    expect(r.net).toBeGreaterThan(0);
    // Ontario provincial ~289 for this salary; Alberta should differ meaningfully
    expect(r.provincialTax).not.toBeCloseTo(289, 0);
  }, 10_000);

  test("$60k — effective tax rate under 30%", async () => {
    const r = unwrap(await calculatePayroll(cfg({ annualSalary: 60_000 }), HEADLESS));

    expect(r.grossIncome).toBe(2500);
    expect(r.net).toBeGreaterThan(0);
    expect(r.totalDeductions / r.grossIncome).toBeLessThan(0.30);
  }, 10_000);

  test("biweekly pay period splits salary into 26", async () => {
    const r = unwrap(await calculatePayroll(cfg({ payPeriod: "Biweekly (26 pay periods a year)" }), HEADLESS));

    // 100000 / 26 = 3846.15
    expect(r.grossIncome).toBeCloseTo(3846.15, 2);
    expect(r.net).toBeGreaterThan(0);
    expect(r.totalDeductions).toBeGreaterThan(0);
  }, 10_000);
});
