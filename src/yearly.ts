import { ok, err, type Result } from "neverthrow";
import * as R from "remeda";
import { PAY_PERIODS, type PayrollConfig, type PayrollResult, type PayrollService } from "./types";

export const CPP_MAX_BASE = 4_230.45;
export const CPP2_MAX = 416.00;
export const EI_MAX = 1_123.07;

export { PAY_PERIODS as PAY_PERIOD_COUNTS } from "./types";

export interface PayPeriodRow {
  period: number;
  grossIncome: number;
  rrspMatched: number;
  rrspUnmatched: number;
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
    rrspMatched: number;
    rrspUnmatched: number;
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

interface ReduceAcc {
  cumulative: Cumulative;
  rows: PayPeriodRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const clampToRemaining = (perPeriod: number, cumulative: number, max: number): number =>
  cumulative >= max ? 0 : Math.min(perPeriod, max - cumulative);

const periodDeductions = (active: PayrollResult, cum: Cumulative) => ({
  cpp: clampToRemaining(active.cpp, cum.cpp, CPP_MAX_BASE),
  cpp2: clampToRemaining(active.cpp2, cum.cpp2, CPP2_MAX),
  ei: clampToRemaining(active.ei, cum.ei, EI_MAX),
});

const allMaxed = (cum: Cumulative, active: PayrollResult) =>
  cum.cpp >= CPP_MAX_BASE &&
  (cum.cpp2 >= CPP2_MAX || active.cpp2 === 0) &&
  cum.ei >= EI_MAX;

const periodTaxes = (active: PayrollResult, maxed: PayrollResult, cum: Cumulative) =>
  allMaxed(cum, active)
    ? { federalTax: maxed.federalTax, provincialTax: maxed.provincialTax }
    : { federalTax: active.federalTax, provincialTax: active.provincialTax };

const advanceCumulative = (cum: Cumulative, ded: { cpp: number; cpp2: number; ei: number }): Cumulative => ({
  cpp: round2(cum.cpp + ded.cpp),
  cpp2: round2(cum.cpp2 + ded.cpp2),
  ei: round2(cum.ei + ded.ei),
});

const totalDeductions = (taxes: { federalTax: number; provincialTax: number }, ded: { cpp: number; cpp2: number; ei: number }) =>
  taxes.federalTax + taxes.provincialTax + ded.cpp + ded.cpp2 + ded.ei;

const buildRow = (period: number, active: PayrollResult, maxed: PayrollResult, cum: Cumulative) =>
  R.pipe(
    { ded: periodDeductions(active, cum), taxes: periodTaxes(active, maxed, cum) },
    ctx => ({ ...ctx, totalDed: totalDeductions(ctx.taxes, ctx.ded), nextCum: advanceCumulative(cum, ctx.ded) }),
    ({ ded, taxes, totalDed, nextCum }): { row: PayPeriodRow; nextCumulative: Cumulative } => ({
      row: {
        period,
        grossIncome: active.grossIncome,
        rrspMatched: active.rrspMatched,
        rrspUnmatched: active.rrspUnmatched,
        rrspEmployer: active.rrspEmployer,
        ...taxes, ...ded,
        totalDeductions: totalDed,
        netPay: active.grossIncome - totalDed,
        cumulativeCpp: nextCum.cpp,
        cumulativeCpp2: nextCum.cpp2,
        cumulativeEi: nextCum.ei,
      },
      nextCumulative: nextCum,
    }),
  );

const sumField = (rows: PayPeriodRow[], field: keyof PayPeriodRow) =>
  round2(R.sumBy(rows, r => r[field]));

const sumTotals = (rows: PayPeriodRow[]): YearlyResult["totals"] => ({
  grossIncome:   sumField(rows, "grossIncome"),
  rrspMatched:   sumField(rows, "rrspMatched"),
  rrspUnmatched: sumField(rows, "rrspUnmatched"),
  rrspEmployer:  sumField(rows, "rrspEmployer"),
  federalTax:     sumField(rows, "federalTax"),
  provincialTax:  sumField(rows, "provincialTax"),
  cpp:            sumField(rows, "cpp"),
  cpp2:           sumField(rows, "cpp2"),
  ei:             sumField(rows, "ei"),
  totalDeductions: sumField(rows, "totalDeductions"),
  netPay:         sumField(rows, "netPay"),
});

const INITIAL_ACC: ReduceAcc = { cumulative: { cpp: 0, cpp2: 0, ei: 0 }, rows: [] };

export const buildYearlyTable = (
  active: PayrollResult,
  maxed: PayrollResult,
  config: PayrollConfig,
  periodsPerYear: number,
): YearlyResult =>
  R.pipe(
    R.range(1, periodsPerYear + 1),
    R.reduce(
      (acc: ReduceAcc, period) => {
        const { row, nextCumulative } = buildRow(period, active, maxed, acc.cumulative);
        return { cumulative: nextCumulative, rows: [...acc.rows, row] };
      },
      INITIAL_ACC,
    ),
    ({ rows }) => ({ rows, totals: sumTotals(rows) }),
  );

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
