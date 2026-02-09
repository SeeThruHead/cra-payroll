import { ok, err, type Result } from "neverthrow";
import * as R from "remeda";
import { type PayrollConfig, type PayrollResult } from "./types";

const PATTERNS: Record<string, RegExp> = {
  grossIncome:     /Salary or wages income\s+([\d,]+\.\d{2})/,
  federalTax:      /Federal tax deduction\s+([\d,]+\.\d{2})/,
  provincialTax:   /Provincial tax deduction\s+([\d,]+\.\d{2})/,
  cpp:             /CPP deductions\s+([\d,]+\.\d{2})/,
  cpp2:            /CPP2 deductions\s+([\d,]+\.\d{2})/,
  ei:              /EI deductions\s+([\d,]+\.\d{2})/,
  totalDeductions: /Total deductions\s+([\d,]+\.\d{2})/,
  net:             /Net amount\s+([\d,]+\.\d{2})/,
};

const extractField = (text: string, pattern: RegExp): number | null => {
  const match = text.match(pattern);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
};

const extractAll = (text: string) =>
  R.pipe(
    R.entries(PATTERNS),
    R.reduce(
      (acc: { values: Record<string, number>; missing: string[] }, [key, pattern]) => {
        const value = extractField(text, pattern);
        return value === null
          ? { ...acc, missing: [...acc.missing, key] }
          : { ...acc, values: { ...acc.values, [key]: value } };
      },
      { values: {}, missing: [] },
    ),
  );

const rrspPerPeriod = (salary: number, percent: number, periods: number) =>
  Math.round(salary * (percent / 100) / periods * 100) / 100;

export const parseResults = (
  text: string,
  config: PayrollConfig,
  periodsPerYear: number,
): Result<PayrollResult, string> =>
  R.pipe(
    extractAll(text),
    ({ values, missing }) =>
      (values.grossIncome ?? 0) === 0 && config.annualSalary > 0
        ? err(`Parsed $0 gross — CRA format may have changed. Missing: ${missing.join(", ")}`)
        : ok({
            grossIncome:     values.grossIncome ?? 0,
            federalTax:      values.federalTax ?? 0,
            provincialTax:   values.provincialTax ?? 0,
            cpp:             values.cpp ?? 0,
            cpp2:            values.cpp2 ?? 0,
            ei:              values.ei ?? 0,
            totalDeductions: values.totalDeductions ?? 0,
            net:             values.net ?? 0,
            rrspEmployee:    rrspPerPeriod(config.annualSalary, config.rrspEmployeePercent, periodsPerYear),
            rrspEmployer:    rrspPerPeriod(config.annualSalary, config.rrspEmployerPercent, periodsPerYear),
          }),
  );
