import { money, line } from "./format";
import type { YearlyResult } from "../yearly";

function renderBreakdown(
  label: string,
  totals: YearlyResult["totals"],
  divisor: number = 1,
): string {
  const W = 42;
  const f = (n: number) => money(n / divisor).padStart(10);
  const lines = [
    "",
    `${label}`,
    line("═", W),
    `  Gross Income:       $${f(totals.grossIncome)}`,
  ];

  if (totals.rrspEmployee > 0)
    lines.push(`  RRSP (Employee):   -$${f(totals.rrspEmployee)}`);
  if (totals.rrspEmployer > 0 && divisor === 1)
    lines.push(`  RRSP (Employer):   -$${f(totals.rrspEmployer)}`);

  lines.push(line("─", W));
  lines.push(`  Federal Tax:       -$${f(totals.federalTax)}`);
  lines.push(`  Provincial Tax:    -$${f(totals.provincialTax)}`);
  lines.push(`  CPP:               -$${f(totals.cpp)}`);
  if (totals.cpp2 > 0) lines.push(`  CPP2:              -$${f(totals.cpp2)}`);
  lines.push(`  EI:                -$${f(totals.ei)}`);
  lines.push(line("─", W));
  lines.push(`  Total Deductions:  -$${f(totals.totalDeductions)}`);
  lines.push(line("═", W));
  lines.push(`  Net Pay:             $${f(totals.netPay)}`);

  if (totals.rrspEmployee > 0) {
    lines.push(`     (after RRSP):     $${money((totals.netPay - totals.rrspEmployee) / divisor).padStart(10)}`);
  }

  return lines.join("\n");
}

export function renderAnnual(totals: YearlyResult["totals"]): string {
  return renderBreakdown("Annual Totals", totals);
}

export function renderMonthly(totals: YearlyResult["totals"]): string {
  return renderBreakdown("Monthly Averages", totals, 12);
}
