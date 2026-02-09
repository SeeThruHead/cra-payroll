import * as R from "remeda";
import { money, line, when } from "./format";
import type { YearlyResult, PayPeriodRow } from "../yearly";

const annotate = (r: PayPeriodRow, first: PayPeriodRow): string => {
  if (r.cpp === 0 && r.cpp2 === 0 && r.ei === 0) return " ✓ maxed";
  if (r.cpp < first.cpp || r.ei < first.ei) return " ← partial";
  return "";
};

export const renderTable = (yearly: YearlyResult, periodsPerYear: number): string => {
  const { rows, totals } = yearly;
  const hasRrsp = totals.rrspEmployee > 0 || totals.rrspEmployer > 0;
  const takeHome = totals.netPay - totals.rrspEmployee;

  // Column widths sized to the widest value (totals row)
  const w = (label: string, n: number) => Math.max(label.length, money(n).length);
  const wGross = w("Gross", totals.grossIncome);
  const wFed   = w("Fed Tax", totals.federalTax);
  const wProv  = w("Prov Tax", totals.provincialTax);
  const wCpp   = w("CPP", totals.cpp);
  const wCpp2  = w("CPP2", totals.cpp2);
  const wEi    = w("EI", totals.ei);
  const wNet   = w("Net Pay", totals.netPay);
  const wRrsp  = w("RRSP Emp", totals.rrspEmployee);
  const wTake  = w("Take Home", takeHome);
  const wCum   = w("Cum CPP/EI", totals.cpp + totals.ei);

  const m = (n: number, width: number) => money(n).padStart(width);
  const h = (s: string, width: number) => s.padStart(width);

  const header = [
    "  #  ",
    h("Gross", wGross), h("Fed Tax", wFed), h("Prov Tax", wProv),
    h("CPP", wCpp), h("CPP2", wCpp2), h("EI", wEi), h("Net Pay", wNet),
    ...(hasRrsp ? [h("RRSP Emp", wRrsp), h("Take Home", wTake)] : []),
    h("Cum CPP/EI", wCum),
  ].join(" │ ");

  const W = header.length;

  const renderRow = (r: PayPeriodRow) => [
    ` ${String(r.period).padStart(3)} `,
    m(r.grossIncome, wGross), m(r.federalTax, wFed), m(r.provincialTax, wProv),
    m(r.cpp, wCpp), m(r.cpp2, wCpp2), m(r.ei, wEi), m(r.netPay, wNet),
    ...(hasRrsp ? [m(r.rrspEmployee, wRrsp), m(r.netPay - r.rrspEmployee, wTake)] : []),
    m(r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi, wCum) + annotate(r, rows[0]),
  ].join(" │ ");

  const totalsRow = [
    " TOT ",
    m(totals.grossIncome, wGross), m(totals.federalTax, wFed), m(totals.provincialTax, wProv),
    m(totals.cpp, wCpp), m(totals.cpp2, wCpp2), m(totals.ei, wEi), m(totals.netPay, wNet),
    ...(hasRrsp ? [m(totals.rrspEmployee, wRrsp), m(takeHome, wTake)] : []),
    h("", wCum),
  ].join(" │ ");

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
