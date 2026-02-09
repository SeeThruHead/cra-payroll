import { money, line } from "./format";
import type { PayrollResult } from "../types";

export function renderSingleResult(r: PayrollResult): string {
  const W = 42;
  const f = (n: number) => money(n).padStart(10);
  const lines = [
    "Results (per pay period)",
    line("═", W),
    `  Gross Income:       $${f(r.grossIncome)}`,
  ];

  if (r.rrspEmployee > 0) lines.push(`  RRSP (Employee):   -$${f(r.rrspEmployee)}`);
  if (r.rrspEmployer > 0) lines.push(`  RRSP (Employer):   -$${f(r.rrspEmployer)}`);

  lines.push(line("─", W));
  lines.push(`  Federal Tax:       -$${f(r.federalTax)}`);
  lines.push(`  Provincial Tax:    -$${f(r.provincialTax)}`);
  lines.push(`  CPP:               -$${f(r.cppDeductions)}`);
  if (r.cpp2Deductions > 0) lines.push(`  CPP2:              -$${f(r.cpp2Deductions)}`);
  lines.push(`  EI:                -$${f(r.eiDeductions)}`);
  lines.push(line("─", W));
  lines.push(`  Total Deductions:  -$${f(r.totalDeductions)}`);
  lines.push(line("═", W));
  lines.push(`  Net Pay:             $${f(r.netAmount)}`);
  if (r.rrspEmployee > 0) {
    lines.push(`     (after RRSP):     $${f(r.netAmount - r.rrspEmployee)}`);
  }

  return lines.join("\n");
}
