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

interface Cumulative {
  cpp: number;
  cpp2: number;
  ei: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const clampToRemaining = (perPeriod: number, cumulative: number, max: number): number =>
  cumulative >= max ? 0 : Math.min(perPeriod, max - cumulative);

const buildRow = (
  period: number,
  active: PayrollResult,
  maxed: PayrollResult,
  cum: Cumulative,
): { row: PayPeriodRow; nextCumulative: Cumulative } => {
  const cpp = clampToRemaining(active.cpp, cum.cpp, CPP_MAX_BASE);
  const cpp2 = clampToRemaining(active.cpp2, cum.cpp2, CPP2_MAX);
  const ei = clampToRemaining(active.ei, cum.ei, EI_MAX);

  const allMaxed =
    (cum.cpp >= CPP_MAX_BASE) &&
    (cum.cpp2 >= CPP2_MAX || active.cpp2 === 0) &&
    (cum.ei >= EI_MAX);

  const federalTax = allMaxed ? maxed.federalTax : active.federalTax;
  const provincialTax = allMaxed ? maxed.provincialTax : active.provincialTax;
  const totalDeductions = federalTax + provincialTax + cpp + cpp2 + ei;

  const nextCumulative: Cumulative = {
    cpp: round2(cum.cpp + cpp),
    cpp2: round2(cum.cpp2 + cpp2),
    ei: round2(cum.ei + ei),
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
    cumulativeCpp: nextCumulative.cpp,
    cumulativeCpp2: nextCumulative.cpp2,
    cumulativeEi: nextCumulative.ei,
  };

  return { row, nextCumulative };
};

const sumTotals = (rows: PayPeriodRow[]): YearlyResult["totals"] => {
  const sum = (fn: (r: PayPeriodRow) => number) => round2(R.sumBy(rows, fn));
  return {
    grossIncome:    sum(r => r.grossIncome),
    rrspEmployee:   sum(r => r.rrspEmployee),
    rrspEmployer:   sum(r => r.rrspEmployer),
    federalTax:     sum(r => r.federalTax),
    provincialTax:  sum(r => r.provincialTax),
    cpp:            sum(r => r.cpp),
    cpp2:           sum(r => r.cpp2),
    ei:             sum(r => r.ei),
    totalDeductions: sum(r => r.totalDeductions),
    netPay:         sum(r => r.netPay),
  };
};

export const buildYearlyTable = (
  active: PayrollResult,
  maxed: PayrollResult,
  config: PayrollConfig,
  periodsPerYear: number,
): YearlyResult => {
  const initial = { cumulative: { cpp: 0, cpp2: 0, ei: 0 } as Cumulative, rows: [] as PayPeriodRow[] };

  const { rows } = R.pipe(
    R.range(1, periodsPerYear + 1),
    R.reduce((acc, period) => {
      const { row, nextCumulative } = buildRow(period, active, maxed, acc.cumulative);
      return { cumulative: nextCumulative, rows: [...acc.rows, row] };
    }, initial),
  );

  return { rows, totals: sumTotals(rows) };
};

export const calculateYearly = async (
  service: PayrollService,
  config: PayrollConfig,
  headless: boolean = false,
): Promise<Result<YearlyResult, string>> => {
  const periodsPerYear = PAY_PERIODS[config.payPeriod];
  if (!periodsPerYear) return err(`Unknown pay period: "${config.payPeriod}"`);

  const [activeResult, maxedResult] = await Promise.all([
    service.calculate({ ...config, cppMaxedOut: false, eiMaxedOut: false }, headless),
    service.calculate({ ...config, cppMaxedOut: true, eiMaxedOut: true }, headless),
  ]);

  if (activeResult.isErr()) return err(`CPP/EI active run: ${activeResult.error}`);
  if (maxedResult.isErr()) return err(`CPP/EI maxed run: ${maxedResult.error}`);

  return ok(buildYearlyTable(activeResult.value, maxedResult.value, config, periodsPerYear));
};
