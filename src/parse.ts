/**
 * Parse CRA PDOC results page text into structured PayrollResult.
 * Pure functions — no IO, no browser.
 */
import { ok, err, type Result } from "neverthrow";
import * as R from "remeda";
import { type PayrollConfig, type PayrollResult } from "./types";

const PATTERNS: Record<string, RegExp> = {
  grossIncome:     /Salary or wages income\s+([\d,]+\.\d{2})/,
  federalTax:      /Federal tax deduction\s+([\d,]+\.\d{2})/,
  provincialTax:   /Provincial tax deduction\s+([\d,]+\.\d{2})/,
  cppDeductions:   /CPP deductions\s+([\d,]+\.\d{2})/,
  cpp2Deductions:  /CPP2 deductions\s+([\d,]+\.\d{2})/,
  eiDeductions:    /EI deductions\s+([\d,]+\.\d{2})/,
  totalDeductions: /Total deductions\s+([\d,]+\.\d{2})/,
  netAmount:       /Net amount\s+([\d,]+\.\d{2})/,
};

function extractField(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

function extractAll(text: string): { values: Record<string, number>; missing: string[] } {
  return R.pipe(
    R.entries(PATTERNS),
    R.reduce(
      (acc, [key, pattern]) => {
        const value = extractField(text, pattern);
        if (value === null) {
          return { values: acc.values, missing: [...acc.missing, key] };
        }
        return { values: { ...acc.values, [key]: value }, missing: acc.missing };
      },
      { values: {} as Record<string, number>, missing: [] as string[] }
    ),
  );
}

function computeRrsp(config: PayrollConfig, periodsPerYear: number) {
  const employee = R.pipe(
    config.annualSalary * (config.rrspEmployeePercent / 100) / periodsPerYear,
    n => Math.round(n * 100) / 100,
  );
  const employer = R.pipe(
    config.annualSalary * (config.rrspEmployerPercent / 100) / periodsPerYear,
    n => Math.round(n * 100) / 100,
  );
  return { employee, employer };
}

export function parseResults(
  text: string,
  config: PayrollConfig,
  periodsPerYear: number,
): Result<PayrollResult, string> {
  const { values, missing } = extractAll(text);

  if ((values.grossIncome ?? 0) === 0 && config.annualSalary > 0) {
    return err(`Parsed $0 gross — CRA format may have changed. Missing: ${missing.join(", ")}`);
  }

  const rrsp = computeRrsp(config, periodsPerYear);

  return ok({
    grossIncome:     values.grossIncome ?? 0,
    federalTax:      values.federalTax ?? 0,
    provincialTax:   values.provincialTax ?? 0,
    cppDeductions:   values.cppDeductions ?? 0,
    cpp2Deductions:  values.cpp2Deductions ?? 0,
    eiDeductions:    values.eiDeductions ?? 0,
    totalDeductions: values.totalDeductions ?? 0,
    netAmount:       values.netAmount ?? 0,
    rrspEmployee:    rrsp.employee,
    rrspEmployer:    rrsp.employer,
  });
}
