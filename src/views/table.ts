import { money, line, when } from "./format";
import type { YearlyResult, PayPeriodRow } from "../yearly";

const annotate = (r: PayPeriodRow, first: PayPeriodRow): string => {
  if (r.cpp === 0 && r.cpp2 === 0 && r.ei === 0) return " ✓ maxed";
  if (r.cpp < first.cpp || r.ei < first.ei) return " ← partial";
  return "";
};

interface Row {
  label: string;
  gross: string;
  fedTax: string;
  provTax: string;
  cpp: string;
  cpp2: string;
  ei: string;
  netPay: string;
  rrspEmp?: string;
  takeHome?: string;
  cumCppEi: string;
  suffix?: string;
}

const renderRow = (r: Row): string =>
  `${r.label} │ ${r.gross} │ ${r.fedTax} │ ${r.provTax} │ ${r.cpp} │ ${r.cpp2} │ ${r.ei} │ ${r.netPay}${r.rrspEmp !== undefined ? ` │ ${r.rrspEmp} │ ${r.takeHome}` : ""} │ ${r.cumCppEi}${r.suffix ?? ""}`;

const m = (n: number, w: number) => money(n).padStart(w);
const p = (s: string, w: number) => s.padStart(w);

export const renderTable = (yearly: YearlyResult, periodsPerYear: number): string => {
  const { rows, totals } = yearly;
  const hasRrsp = totals.rrspEmployee > 0 || totals.rrspEmployer > 0;
  const takeHome = totals.netPay - totals.rrspEmployee;

  const toRow = (r: PayPeriodRow): Row => ({
    label: ` ${String(r.period).padStart(3)} `,
    gross: m(r.grossIncome, 10),
    fedTax: m(r.federalTax, 10),
    provTax: m(r.provincialTax, 10),
    cpp: m(r.cpp, 10),
    cpp2: m(r.cpp2, 6),
    ei: m(r.ei, 10),
    netPay: m(r.netPay, 10),
    ...(hasRrsp ? { rrspEmp: m(r.rrspEmployee, 10), takeHome: m(r.netPay - r.rrspEmployee, 10) } : {}),
    cumCppEi: m(r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi, 10),
    suffix: annotate(r, rows[0]),
  });

  const header: Row = {
    label: "  #  ",
    gross: p("Gross", 10),
    fedTax: p("Fed Tax", 10),
    provTax: p("Prov Tax", 10),
    cpp: p("CPP", 10),
    cpp2: p("CPP2", 6),
    ei: p("EI", 10),
    netPay: p("Net Pay", 10),
    ...(hasRrsp ? { rrspEmp: p("RRSP Emp", 10), takeHome: p("Take Home", 10) } : {}),
    cumCppEi: p("Cum CPP/EI", 10),
  };

  const totalsRow: Row = {
    label: " TOT ",
    gross: m(totals.grossIncome, 10),
    fedTax: m(totals.federalTax, 10),
    provTax: m(totals.provincialTax, 10),
    cpp: m(totals.cpp, 10),
    cpp2: m(totals.cpp2, 6),
    ei: m(totals.ei, 10),
    netPay: m(totals.netPay, 10),
    ...(hasRrsp ? { rrspEmp: m(totals.rrspEmployee, 10), takeHome: m(takeHome, 10) } : {}),
    cumCppEi: p("", 10),
  };

  const W = renderRow(header).length;

  return `Per-Paycheck Table (2026)
${line("═", W)}
${renderRow(header)}
${line("─", W)}
${rows.map(r => renderRow(toRow(r))).join("\n")}
${line("─", W)}
${renderRow(totalsRow)}
${line("═", W)}${
when(hasRrsp, `\n  RRSP (Employer match): $${money(totals.rrspEmployer)}/yr ($${money(totals.rrspEmployer / periodsPerYear)}/period)`)}`;
};
