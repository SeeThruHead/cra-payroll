import { money, line, when } from "./format";
import type { PayrollResult } from "../types";

const f = (n: number) => money(n).padStart(10);
const W = 42;

export const renderSingleResult = (r: PayrollResult): string =>
`Results (per pay period)
${line("═", W)}
  Gross Income:       $${f(r.grossIncome)}${
  when(r.rrspEmployee, `  RRSP (Employee):   -$${f(r.rrspEmployee)}`)}${
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
  when(r.rrspEmployee, `     (after RRSP):     $${f(r.net - r.rrspEmployee)}`)}`;
