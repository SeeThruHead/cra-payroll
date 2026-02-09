import * as R from "remeda";
import { money, line, when } from "./format";
import type { YearlyResult, PayPeriodRow } from "../yearly";

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

export const renderTable = (yearly: YearlyResult, periodsPerYear: number): string =>
  R.pipe(
    yearly,

    ({ rows, totals }) => {
      const hasRrsp = totals.rrspEmployee > 0 || totals.rrspEmployer > 0;
      const takeHome = totals.netPay - totals.rrspEmployee;
      const rrsp = (fields: Record<string, number | string>) =>
        hasRrsp ? fields : {};

      const toRow = (r: PayPeriodRow): Row => ({
        label: ` ${String(r.period).padStart(3)} `,
        gross: r.grossIncome, fedTax: r.federalTax, provTax: r.provincialTax,
        cpp: r.cpp, cpp2: r.cpp2, ei: r.ei, netPay: r.netPay,
        ...rrsp({ rrspEmp: r.rrspEmployee, takeHome: r.netPay - r.rrspEmployee }),
        cumCppEi: r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi,
        suffix: r.cpp === 0 && r.cpp2 === 0 && r.ei === 0 ? " ✓ maxed"
          : r.cpp < rows[0].cpp || r.ei < rows[0].ei ? " ← partial"
          : "",
      });

      const header = renderRow({
        label: "  #  ",
        gross: "Gross", fedTax: "Fed Tax", provTax: "Prov Tax",
        cpp: "CPP", cpp2: "CPP2", ei: "EI", netPay: "Net Pay",
        ...rrsp({ rrspEmp: "RRSP Emp", takeHome: "Take Home" }),
        cumCppEi: "Cum CPP/EI",
      });

      const totalsStr = renderRow({
        label: " TOT ",
        gross: totals.grossIncome, fedTax: totals.federalTax, provTax: totals.provincialTax,
        cpp: totals.cpp, cpp2: totals.cpp2, ei: totals.ei, netPay: totals.netPay,
        ...rrsp({ rrspEmp: totals.rrspEmployee, takeHome }),
        cumCppEi: "",
      });

      return { rows, totals, hasRrsp, header, totalsStr, toRow };
    },

    ({ rows, totals, hasRrsp, header, totalsStr, toRow }) => {
      const W = header.length;
      return `Per-Paycheck Table (2026)
${line("═", W)}
${header}
${line("─", W)}
${rows.map(r => renderRow(toRow(r))).join("\n")}
${line("─", W)}
${totalsStr}
${line("═", W)}${
when(hasRrsp, `\n  RRSP (Employer match): $${money(totals.rrspEmployer)}/yr ($${money(totals.rrspEmployer / periodsPerYear)}/period)`)}`;
    },
  );
