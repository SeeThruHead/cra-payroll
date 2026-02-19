import type { Result } from "neverthrow";

export interface PayrollConfig {
  province: string;
  annualSalary: number;
  payPeriod: string;
  year: number;
  rrspMatchPercent: number;
  rrspUnmatchedPercent: number;
  cppMaxedOut: boolean;
  eiMaxedOut: boolean;
  /** Available RRSP contribution room — when set, RRSP advice is shown automatically */
  rrspRoom?: number;
  /** Number of children aged 5 and younger (affects METR via CCB) */
  numKids5AndYounger?: number;
  /** Number of children aged 6–17 (affects METR via CCB) */
  numKids6AndOlder?: number;
  /** Whether the filer has a spouse */
  hasSpouse?: boolean;
  /** Spouse's income (affects benefit clawbacks) */
  spouseIncome?: number;
}

export interface PayrollResult {
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
  net: number;
}

export const PAY_PERIODS: Record<string, number> = {
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

/** The contract for anything that can calculate payroll deductions */
export interface PayrollService {
  calculate(config: PayrollConfig, headless: boolean): Promise<Result<PayrollResult, string>>;
}
