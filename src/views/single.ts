import { money, line, when } from "./format";
import type { PayrollResult } from "../types";

const f = (n: number) => money(n).padStart(10);
const W = 42;

export const renderSingleResult = (r: PayrollResult): string => {
  const totalEmployeeRrsp = r.rrspMatched + r.rrspUnmatched;
  return `Results (per pay period)
${line("═", W)}
  Gross Income:       $${f(r.grossIncome)}${
  when(r.rrspMatched, `  RRSP (Matched):    -$${f(r.rrspMatched)}`)}${
  when(r.rrspUnmatched, `  RRSP (Unmatched):  -$${f(r.rrspUnmatched)}`)}${
  when(r.rrspEmployer, `  RRSP (Employer):   -$${f(r.rrspEmployer)}`)}
${line("─", W)}
  Federal Tax:       -$${f(r.federalTax)}
  Provincial Tax:    -$${f(r.provincialTax)}
  CPP:               -$${f(r.cpp)}${
  when(r.cpp2, `  CPP2:              -$${f(r.cpp2)}`)}
  EI:                -$${f(r.ei)}
${line("─", W)}
  Total Deductions:  -$${f(r.totalDeductions)}
${line("═", W)}
  Net Pay:             $${f(r.net)}${
  when(totalEmployeeRrsp, `     (after RRSP):     $${f(r.net - totalEmployeeRrsp)}`)}`;
};
