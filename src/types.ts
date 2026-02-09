import type { Result } from "neverthrow";

export interface PayrollConfig {
  province: string;
  annualSalary: number;
  payPeriod: string;
  rrspEmployeePercent: number;
  rrspEmployerPercent: number;
  cppMaxedOut: boolean;
  eiMaxedOut: boolean;
}

export interface PayrollResult {
  grossIncome: number;
  rrspEmployee: number;
  rrspEmployer: number;
  federalTax: number;
  provincialTax: number;
  cppDeductions: number;
  cpp2Deductions: number;
  eiDeductions: number;
  totalDeductions: number;
  netAmount: number;
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
