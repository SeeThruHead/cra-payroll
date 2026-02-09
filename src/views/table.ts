import { money, line, when } from "./format";
import type { YearlyResult, PayPeriodRow } from "../yearly";

const annotate = (r: PayPeriodRow, first: PayPeriodRow): string => {
  if (r.cpp === 0 && r.cpp2 === 0 && r.ei === 0) return " ✓ maxed";
  if (r.cpp < first.cpp || r.ei < first.ei) return " ← partial";
  return "";
};

interface Row {
  label: string;
  gross: number | string;
  fedTax: number | string;
  provTax: number | string;
  cpp: number | string;
  cpp2: number | string;
  ei: number | string;
  netPay: number | string;
  rrspEmp?: number | string;
  takeHome?: number | string;
  cumCppEi: number | string;
  suffix?: string;
}

const renderRow = (r: Row): string => {
  const c = (v: number | string, w: number) =>
    typeof v === "number" ? money(v).padStart(w) : v.padStart(w);

  return `${r.label} │ ${c(r.gross, 10)} │ ${c(r.fedTax, 10)} │ ${c(r.provTax, 10)} │ ${c(r.cpp, 10)} │ ${c(r.cpp2, 6)} │ ${c(r.ei, 10)} │ ${c(r.netPay, 10)}${r.rrspEmp !== undefined ? ` │ ${c(r.rrspEmp, 10)} │ ${c(r.takeHome!, 10)}` : ""} │ ${c(r.cumCppEi, 10)}${r.suffix ?? ""}`;
};

export const renderTable = (yearly: YearlyResult, periodsPerYear: number): string => {
  const { rows, totals } = yearly;
  const hasRrsp = totals.rrspEmployee > 0 || totals.rrspEmployer > 0;
  const takeHome = totals.netPay - totals.rrspEmployee;

  const toRow = (r: PayPeriodRow): Row => ({
    label: ` ${String(r.period).padStart(3)} `,
    gross: r.grossIncome,
    fedTax: r.federalTax,
    provTax: r.provincialTax,
    cpp: r.cpp,
    cpp2: r.cpp2,
    ei: r.ei,
    netPay: r.netPay,
    ...(hasRrsp ? { rrspEmp: r.rrspEmployee, takeHome: r.netPay - r.rrspEmployee } : {}),
    cumCppEi: r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi,
    suffix: annotate(r, rows[0]),
  });

  const header: Row = {
    label: "  #  ",
    gross: "Gross",
    fedTax: "Fed Tax",
    provTax: "Prov Tax",
    cpp: "CPP",
    cpp2: "CPP2",
    ei: "EI",
    netPay: "Net Pay",
    ...(hasRrsp ? { rrspEmp: "RRSP Emp", takeHome: "Take Home" } : {}),
    cumCppEi: "Cum CPP/EI",
  };

  const totalsRow: Row = {
    label: " TOT ",
    gross: totals.grossIncome,
    fedTax: totals.federalTax,
    provTax: totals.provincialTax,
    cpp: totals.cpp,
    cpp2: totals.cpp2,
    ei: totals.ei,
    netPay: totals.netPay,
    ...(hasRrsp ? { rrspEmp: totals.rrspEmployee, takeHome } : {}),
    cumCppEi: "",
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
