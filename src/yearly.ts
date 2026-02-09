import { ok, err, type Result } from "neverthrow";
import { PAY_PERIODS, type PayrollConfig, type PayrollResult, type PayrollService } from "./types";

// 2026 CPP/EI maximums
export const CPP_MAX_BASE = 4_230.45;
export const CPP2_MAX = 416.00;
export const EI_MAX = 1_123.07;

// Re-export for CLI
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

/** Build a yearly table from two payroll results (active CPP/EI vs maxed) */
export function buildYearlyTable(
  active: PayrollResult,
  maxed: PayrollResult,
  config: PayrollConfig,
  periodsPerYear: number
): YearlyResult {
  const rows: PayPeriodRow[] = [];
  let cumCpp = 0;
  let cumCpp2 = 0;
  let cumEi = 0;

  for (let i = 1; i <= periodsPerYear; i++) {
    const cppMaxed = cumCpp >= CPP_MAX_BASE;
    const cpp2Maxed = cumCpp2 >= CPP2_MAX;
    const eiMaxed = cumEi >= EI_MAX;
    const allMaxed = cppMaxed && cpp2Maxed && eiMaxed;

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

    const federalTax = allMaxed ? maxed.federalTax : active.federalTax;
    const provincialTax = allMaxed ? maxed.provincialTax : active.provincialTax;

    const totalDeductions = federalTax + provincialTax + cpp + cpp2 + ei;
    const netPay = active.grossIncome - totalDeductions;

    cumCpp += cpp;
    cumCpp2 += cpp2;
    cumEi += ei;

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

  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }

  return { rows, totals };
}

/** Run two CRA calculations and build the yearly table */
export async function calculateYearly(
  service: PayrollService,
  config: PayrollConfig,
  headless: boolean = false
): Promise<Result<YearlyResult, string>> {
  const periodsPerYear = PAY_PERIODS[config.payPeriod];
  if (!periodsPerYear) return err(`Unknown pay period: "${config.payPeriod}"`);

  const activeConfig = { ...config, cppMaxedOut: false, eiMaxedOut: false };
  const maxedConfig = { ...config, cppMaxedOut: true, eiMaxedOut: true };

  const [activeResult, maxedResult] = await Promise.all([
    service.calculate(activeConfig, headless),
    service.calculate(maxedConfig, headless),
  ]);

  if (activeResult.isErr()) return err(`CPP/EI active run: ${activeResult.error}`);
  if (maxedResult.isErr()) return err(`CPP/EI maxed run: ${maxedResult.error}`);

  return ok(buildYearlyTable(activeResult.value, maxedResult.value, config, periodsPerYear));
}
