import { money, line, when } from "./format";
import type { YearlyResult, PayPeriodRow } from "../yearly";

const annotate = (r: PayPeriodRow, first: PayPeriodRow): string => {
  if (r.cpp === 0 && r.cpp2 === 0 && r.ei === 0) return " ✓ maxed";
  if (r.cpp < first.cpp || r.ei < first.ei) return " ← partial";
  return "";
};

const m = (n: number, w: number) => money(n).padStart(w);
const h = (s: string, w: number) => s.padStart(w);

export const renderTable = (yearly: YearlyResult, periodsPerYear: number): string => {
  const { rows, totals } = yearly;
  const hasRrsp = totals.rrspEmployee > 0 || totals.rrspEmployer > 0;
  const takeHome = totals.netPay - totals.rrspEmployee;

  const sep = " │ ";

  const header = `  #  ${sep}${h("Gross", 10)}${sep}${h("Fed Tax", 10)}${sep}${h("Prov Tax", 10)}${sep}${h("CPP", 10)}${sep}${h("CPP2", 6)}${sep}${h("EI", 10)}${sep}${h("Net Pay", 10)}${hasRrsp ? `${sep}${h("RRSP Emp", 10)}${sep}${h("Take Home", 10)}` : ""}${sep}${h("Cum CPP/EI", 10)}`;
  const W = header.length;

  const renderRow = (r: PayPeriodRow) =>
    ` ${String(r.period).padStart(3)} ${sep}${m(r.grossIncome, 10)}${sep}${m(r.federalTax, 10)}${sep}${m(r.provincialTax, 10)}${sep}${m(r.cpp, 10)}${sep}${m(r.cpp2, 6)}${sep}${m(r.ei, 10)}${sep}${m(r.netPay, 10)}${hasRrsp ? `${sep}${m(r.rrspEmployee, 10)}${sep}${m(r.netPay - r.rrspEmployee, 10)}` : ""}${sep}${m(r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi, 10)}${annotate(r, rows[0])}`;

  const totalsRow =
    ` TOT ${sep}${m(totals.grossIncome, 10)}${sep}${m(totals.federalTax, 10)}${sep}${m(totals.provincialTax, 10)}${sep}${m(totals.cpp, 10)}${sep}${m(totals.cpp2, 6)}${sep}${m(totals.ei, 10)}${sep}${m(totals.netPay, 10)}${hasRrsp ? `${sep}${m(totals.rrspEmployee, 10)}${sep}${m(takeHome, 10)}` : ""}${sep}${h("", 10)}`;

  return `Per-Paycheck Table (2026)
${line("═", W)}
${header}
${line("─", W)}
${rows.map(renderRow).join("\n")}
${line("─", W)}
${totalsRow}
${line("═", W)}${
when(hasRrsp, `\n  RRSP (Employer match): $${money(totals.rrspEmployer)}/yr ($${money(totals.rrspEmployer / periodsPerYear)}/period)`)}`;
};
