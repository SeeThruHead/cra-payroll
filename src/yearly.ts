/**
 * Yearly paycheck table builder.
 * Pure functions — takes two PayrollResults (active + maxed CPP/EI)
 * and produces the per-period breakdown with CPP/EI tracking.
 */
import { ok, err, type Result } from "neverthrow";
import * as R from "remeda";
import { PAY_PERIODS, type PayrollConfig, type PayrollResult, type PayrollService } from "./types";

// 2026 CPP/EI maximums
export const CPP_MAX_BASE = 4_230.45;
export const CPP2_MAX = 416.00;
export const EI_MAX = 1_123.07;

export { PAY_PERIODS as PAY_PERIOD_COUNTS } from "./types";

export interface PayPeriodRow {
  period: number;
  grossIncome: number;
  rrspEmployee: number;
  rrspEmployer: number;
  federalTax: number;
  provincialTax: number;
  cpp: number;
  cpp2: number;
  ei: number;
  totalDeductions: number;
  netPay: number;
  cumulativeCpp: number;
  cumulativeCpp2: number;
  cumulativeEi: number;
}

export interface YearlyResult {
  rows: PayPeriodRow[];
  totals: {
    grossIncome: number;
    rrspEmployee: number;
    rrspEmployer: number;
    federalTax: number;
    provincialTax: number;
    cpp: number;
    cpp2: number;
    ei: number;
    totalDeductions: number;
    netPay: number;
  };
}

interface Accumulator {
  cumCpp: number;
  cumCpp2: number;
  cumEi: number;
  rows: PayPeriodRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const clampToRemaining = (perPeriod: number, cumulative: number, max: number): number =>
  cumulative >= max ? 0 : Math.min(perPeriod, max - cumulative);

function buildRow(
  period: number,
  active: PayrollResult,
  maxed: PayrollResult,
  acc: Accumulator,
): { row: PayPeriodRow; nextAcc: Accumulator } {
  const cpp = clampToRemaining(active.cppDeductions, acc.cumCpp, CPP_MAX_BASE);
  const cpp2 = clampToRemaining(active.cpp2Deductions, acc.cumCpp2, CPP2_MAX);
  const ei = clampToRemaining(active.eiDeductions, acc.cumEi, EI_MAX);

  const allMaxed =
    (acc.cumCpp >= CPP_MAX_BASE) &&
    (acc.cumCpp2 >= CPP2_MAX || active.cpp2Deductions === 0) &&
    (acc.cumEi >= EI_MAX);

  const federalTax = allMaxed ? maxed.federalTax : active.federalTax;
  const provincialTax = allMaxed ? maxed.provincialTax : active.provincialTax;
  const totalDeductions = federalTax + provincialTax + cpp + cpp2 + ei;

  const nextAcc = {
    cumCpp: round2(acc.cumCpp + cpp),
    cumCpp2: round2(acc.cumCpp2 + cpp2),
    cumEi: round2(acc.cumEi + ei),
    rows: acc.rows,
  };

  const row: PayPeriodRow = {
    period,
    grossIncome: active.grossIncome,
    rrspEmployee: active.rrspEmployee,
    rrspEmployer: active.rrspEmployer,
    federalTax,
    provincialTax,
    cpp, cpp2, ei,
    totalDeductions,
    netPay: active.grossIncome - totalDeductions,
    cumulativeCpp: nextAcc.cumCpp,
    cumulativeCpp2: nextAcc.cumCpp2,
    cumulativeEi: nextAcc.cumEi,
  };

  return { row, nextAcc: { ...nextAcc, rows: [...acc.rows, row] } };
}

function sumTotals(rows: PayPeriodRow[]): YearlyResult["totals"] {
  const sum = (fn: (r: PayPeriodRow) => number) => round2(R.sumBy(rows, fn));
  return {
    grossIncome:  sum(r => r.grossIncome),
    rrspEmployee: sum(r => r.rrspEmployee),
    rrspEmployer: sum(r => r.rrspEmployer),
    federalTax:   sum(r => r.federalTax),
    provincialTax: sum(r => r.provincialTax),
    cpp:          sum(r => r.cpp),
    cpp2:         sum(r => r.cpp2),
    ei:           sum(r => r.ei),
    totalDeductions: sum(r => r.totalDeductions),
    netPay:       sum(r => r.netPay),
  };
}

export function buildYearlyTable(
  active: PayrollResult,
  maxed: PayrollResult,
  config: PayrollConfig,
  periodsPerYear: number,
): YearlyResult {
  const initial: Accumulator = { cumCpp: 0, cumCpp2: 0, cumEi: 0, rows: [] };

  const { rows } = R.pipe(
    R.range(1, periodsPerYear + 1),
    R.reduce((acc, period) => {
      const { nextAcc } = buildRow(period, active, maxed, acc);
      return nextAcc;
    }, initial),
  );

  return { rows, totals: sumTotals(rows) };
}

export async function calculateYearly(
  service: PayrollService,
  config: PayrollConfig,
  headless: boolean = false,
): Promise<Result<YearlyResult, string>> {
  const periodsPerYear = PAY_PERIODS[config.payPeriod];
  if (!periodsPerYear) return err(`Unknown pay period: "${config.payPeriod}"`);

  const [activeResult, maxedResult] = await Promise.all([
    service.calculate({ ...config, cppMaxedOut: false, eiMaxedOut: false }, headless),
    service.calculate({ ...config, cppMaxedOut: true, eiMaxedOut: true }, headless),
  ]);

  if (activeResult.isErr()) return err(`CPP/EI active run: ${activeResult.error}`);
  if (maxedResult.isErr()) return err(`CPP/EI maxed run: ${maxedResult.error}`);

  return ok(buildYearlyTable(activeResult.value, maxedResult.value, config, periodsPerYear));
}
