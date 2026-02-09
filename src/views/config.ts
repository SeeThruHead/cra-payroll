import { money, line } from "./format";
import type { PayrollConfig } from "../types";

export const renderConfig = (config: PayrollConfig, showCppEi: boolean): string => {
  const lines = [
    "",
    "CRA Payroll Deductions Calculator",
    line("─", 40),
    `Province:          ${config.province}`,
    `Annual Salary:     $${money(config.annualSalary)}`,
    `Pay Period:        ${config.payPeriod}`,
    `RRSP (Employee):   ${config.rrspEmployeePercent}%`,
    `RRSP (Employer):   ${config.rrspEmployerPercent}%`,
  ];

  if (showCppEi) {
    lines.push(`CPP Maxed Out:     ${config.cppMaxedOut ? "Yes" : "No"}`);
    lines.push(`EI Maxed Out:      ${config.eiMaxedOut ? "Yes" : "No"}`);
  }

  lines.push(line("─", 40));
  lines.push("Calculating via CRA PDOC...\n");

  return lines.join("\n");
};
