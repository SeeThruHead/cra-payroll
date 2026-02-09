import { money, line, when } from "./format";
import type { YearlyResult } from "../yearly";

const W = 42;

const renderBreakdown = (
  label: string,
  totals: YearlyResult["totals"],
  divisor: number = 1,
): string => {
  const f = (n: number) => money(n / divisor).padStart(10);
  return `
${label}
${line("═", W)}
  Gross Income:       $${f(totals.grossIncome)}${
  when(totals.rrspEmployee, `  RRSP (Employee):   -$${f(totals.rrspEmployee)}`)}${
  when(totals.rrspEmployer && divisor === 1, `  RRSP (Employer):   -$${f(totals.rrspEmployer)}`)}
${line("─", W)}
  Federal Tax:       -$${f(totals.federalTax)}
  Provincial Tax:    -$${f(totals.provincialTax)}
  CPP:               -$${f(totals.cpp)}${
  when(totals.cpp2, `  CPP2:              -$${f(totals.cpp2)}`)}
  EI:                -$${f(totals.ei)}
${line("─", W)}
  Total Deductions:  -$${f(totals.totalDeductions)}
${line("═", W)}
  Net Pay:             $${f(totals.netPay)}${
  when(totals.rrspEmployee, `     (after RRSP):     $${money((totals.netPay - totals.rrspEmployee) / divisor).padStart(10)}`)}`;
};

export const renderAnnual = (totals: YearlyResult["totals"]): string =>
  renderBreakdown("Annual Totals", totals);

export const renderMonthly = (totals: YearlyResult["totals"]): string =>
  renderBreakdown("Monthly Averages", totals, 12);
