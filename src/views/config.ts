import { money, line, when } from "./format";
import type { PayrollConfig } from "../types";

export const renderConfig = (config: PayrollConfig, showCppEi: boolean): string =>
`
CRA Payroll Deductions Calculator
${line("─", 40)}
Province:          ${config.province}
Annual Salary:     $${money(config.annualSalary)}
Pay Period:        ${config.payPeriod}
RRSP (Employee):   ${config.rrspEmployeePercent}%
RRSP (Employer):   ${config.rrspEmployerPercent}%${
when(showCppEi, `CPP Maxed Out:     ${config.cppMaxedOut ? "Yes" : "No"}\nEI Maxed Out:      ${config.eiMaxedOut ? "Yes" : "No"}`)}
${line("─", 40)}
Calculating via CRA PDOC...
`;
