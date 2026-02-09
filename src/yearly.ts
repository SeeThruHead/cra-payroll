import { ok, err, type Result } from "neverthrow";
import { calculatePayroll, type PayrollConfig, type PayrollResult } from "./calculator";

// 2026 CPP/EI maximums
export const CPP_MAX_BASE = 4_230.45;
export const CPP2_MAX = 416.00;
export const EI_MAX = 1_123.07;

export const PAY_PERIOD_COUNTS: Record<string, number> = {
  "Daily (240 pay periods a year)": 240,
  "Weekly (52 pay periods a year)": 52,
  "Biweekly (26 pay periods a year)": 26,
  "Semi-monthly (24 pay periods a year)": 24,
  "Monthly (12 pay periods a year)": 12,
  "(10 pay periods a year)": 10,
  "(13 pay periods a year)": 13,
  "(22 pay periods a year)": 22,
  "Weekly (53 pay periods a year)": 53,
  "Biweekly (27 pay periods a year)": 27,
};

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

export async function calculateYearly(
  config: PayrollConfig,
  headless: boolean = false
): Promise<Result<YearlyResult, string>> {
  const periodsPerYear = PAY_PERIOD_COUNTS[config.payPeriod];
  if (!periodsPerYear) return err(`Unknown pay period: "${config.payPeriod}"`);

  // Run CRA twice: once with CPP/EI active, once with them maxed out
  const activeConfig = { ...config, cppMaxedOut: false, eiMaxedOut: false };
  const maxedConfig = { ...config, cppMaxedOut: true, eiMaxedOut: true };

  const [activeResult, maxedResult] = await Promise.all([
    calculatePayroll(activeConfig, headless),
    calculatePayroll(maxedConfig, headless),
  ]);

  if (activeResult.isErr()) return err(`CPP/EI active run: ${activeResult.error}`);
  if (maxedResult.isErr()) return err(`CPP/EI maxed run: ${maxedResult.error}`);

  const active = activeResult.value;
  const maxed = maxedResult.value;

  // Build per-period table
  const rows: PayPeriodRow[] = [];
  let cumCpp = 0;
  let cumCpp2 = 0;
  let cumEi = 0;

  for (let i = 1; i <= periodsPerYear; i++) {
    const cppMaxed = cumCpp >= CPP_MAX_BASE;
    const cpp2Maxed = cumCpp2 >= CPP2_MAX;
    const eiMaxed = cumEi >= EI_MAX;
    const allMaxed = cppMaxed && cpp2Maxed && eiMaxed;

    // Use the maxed result when all are maxed, otherwise use active
    // For partial periods (when one maxes mid-period), calculate the remainder
    let cpp = 0;
    let cpp2 = 0;
    let ei = 0;

    if (!cppMaxed) {
      const remaining = CPP_MAX_BASE - cumCpp;
      cpp = Math.min(active.cppDeductions, remaining);
    }

    if (!cpp2Maxed) {
      const remaining = CPP2_MAX - cumCpp2;
      cpp2 = Math.min(active.cpp2Deductions, remaining);
    }

    if (!eiMaxed) {
      const remaining = EI_MAX - cumEi;
      ei = Math.min(active.eiDeductions, remaining);
    }

    // Taxes: use maxed rates when CPP/EI are all done, active rates otherwise
    // In reality taxes shift slightly when CPP/EI stop, CRA accounts for this
    const federalTax = allMaxed ? maxed.federalTax : active.federalTax;
    const provincialTax = allMaxed ? maxed.provincialTax : active.provincialTax;

    const totalDeductions = federalTax + provincialTax + cpp + cpp2 + ei;
    const netPay = active.grossIncome - totalDeductions;

    cumCpp += cpp;
    cumCpp2 += cpp2;
    cumEi += ei;

    // Round to avoid floating point drift
    cumCpp = Math.round(cumCpp * 100) / 100;
    cumCpp2 = Math.round(cumCpp2 * 100) / 100;
    cumEi = Math.round(cumEi * 100) / 100;

    rows.push({
      period: i,
      grossIncome: active.grossIncome,
      rrspEmployee: active.rrspEmployee,
      rrspEmployer: active.rrspEmployer,
      federalTax,
      provincialTax,
      cpp,
      cpp2,
      ei,
      totalDeductions,
      netPay,
      cumulativeCpp: cumCpp,
      cumulativeCpp2: cumCpp2,
      cumulativeEi: cumEi,
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({
      grossIncome: acc.grossIncome + r.grossIncome,
      rrspEmployee: acc.rrspEmployee + r.rrspEmployee,
      rrspEmployer: acc.rrspEmployer + r.rrspEmployer,
      federalTax: acc.federalTax + r.federalTax,
      provincialTax: acc.provincialTax + r.provincialTax,
      cpp: acc.cpp + r.cpp,
      cpp2: acc.cpp2 + r.cpp2,
      ei: acc.ei + r.ei,
      totalDeductions: acc.totalDeductions + r.totalDeductions,
      netPay: acc.netPay + r.netPay,
    }),
    { grossIncome: 0, rrspEmployee: 0, rrspEmployer: 0, federalTax: 0, provincialTax: 0, cpp: 0, cpp2: 0, ei: 0, totalDeductions: 0, netPay: 0 }
  );

  // Round totals
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }

  return ok({ rows, totals });
}
