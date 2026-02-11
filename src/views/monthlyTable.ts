import * as R from "remeda";
import { money, line, when, pct } from "./format";
import type { MonthlyResult, MonthlyRow } from "../monthly";

interface Row {
  label: string;
  gross: number | string;
  fedTax: number | string;
  provTax: number | string;
  cpp: number | string;
  cpp2: number | string;
  ei: number | string;
  netPay: number | string;
  rrspYou?: number | string;
  rrspEr?: number | string;
  takeHome?: number | string;
}

const col = (v: number | string, w: number) =>
  typeof v === "number" ? money(v).padStart(w) : v.padStart(w);

const renderRow = (r: Row): string =>
  `${r.label} │ ${col(r.gross, 10)} │ ${col(r.fedTax, 10)} │ ${col(r.provTax, 10)} │ ${col(r.cpp, 10)} │ ${col(r.cpp2, 6)} │ ${col(r.ei, 10)} │ ${col(r.netPay, 10)}${r.rrspYou !== undefined ? ` │ ${col(r.rrspYou, 10)} │ ${col(r.rrspEr!, 10)} │ ${col(r.takeHome!, 10)}` : ""}`;

const totalEmployeeRrsp = (r: MonthlyRow) => r.rrspMatched + r.rrspUnmatched;
const totalEmployeeRrspTotals = (t: MonthlyResult["totals"]) => t.rrspMatched + t.rrspUnmatched;

const showRrsp = (totals: MonthlyResult["totals"]) =>
  totals.rrspMatched > 0 || totals.rrspUnmatched > 0 || totals.rrspEmployer > 0;

const rrspFields = (show: boolean, fields: Record<string, number | string>) =>
  show ? fields : {};

const toRow = (r: MonthlyRow, rrsp: boolean): Row => ({
  label: ` ${r.month} `,
  gross: r.grossIncome, fedTax: r.federalTax, provTax: r.provincialTax,
  cpp: r.cpp, cpp2: r.cpp2, ei: r.ei, netPay: r.netPay,
  ...rrspFields(rrsp, { rrspYou: totalEmployeeRrsp(r), rrspEr: r.rrspEmployer, takeHome: r.netPay - totalEmployeeRrsp(r) }),
});

const headerRow = (rrsp: boolean): Row => ({
  label: "     ",
  gross: "Gross", fedTax: "Fed Tax", provTax: "Prov Tax",
  cpp: "CPP", cpp2: "CPP2", ei: "EI", netPay: "Net Pay",
  ...rrspFields(rrsp, { rrspYou: "RRSP You", rrspEr: "RRSP Er", takeHome: "Take Home" }),
});

const totalsRow = (totals: MonthlyResult["totals"], rrsp: boolean): Row => ({
  label: " TOT ",
  gross: totals.grossIncome, fedTax: totals.federalTax, provTax: totals.provincialTax,
  cpp: totals.cpp, cpp2: totals.cpp2, ei: totals.ei, netPay: totals.netPay,
  ...rrspFields(rrsp, { rrspYou: totalEmployeeRrspTotals(totals), rrspEr: totals.rrspEmployer, takeHome: totals.netPay - totalEmployeeRrspTotals(totals) }),
});

export const renderMonthlyTable = (monthly: MonthlyResult, year: number = 2026): string =>
  R.pipe(
    monthly,
    ctx => ({ ...ctx, rrsp: showRrsp(ctx.totals) }),
    ctx => ({ ...ctx, header: renderRow(headerRow(ctx.rrsp)) }),
    ctx => ({ ...ctx, bodyRows: ctx.rows.map(r => renderRow(toRow(r, ctx.rrsp))) }),
    ctx => ({ ...ctx, totalsStr: renderRow(totalsRow(ctx.totals, ctx.rrsp)), W: ctx.header.length }),
    ctx => {
      const t = ctx.totals;
      const empTotal = totalEmployeeRrspTotals(t);
      const rrspSummary = !ctx.rrsp ? "" : `
  RRSP You:  $${money(empTotal)}/yr${
  t.rrspMatched > 0 ? `  — matched: $${money(t.rrspMatched)}/yr` : ""}${
  t.rrspUnmatched > 0 ? `  — unmatched: $${money(t.rrspUnmatched)}/yr` : ""}
  RRSP Er:   $${money(t.rrspEmployer)}/yr
  RRSP Total (You + Er): $${money(empTotal + t.rrspEmployer)}/yr`;
      const taxRate = t.grossIncome > 0 ? (t.totalDeductions / t.grossIncome) * 100 : 0;
      return `Monthly Table (${year})
${line("═", ctx.W)}
${ctx.header}
${line("─", ctx.W)}
${ctx.bodyRows.join("\n")}
${line("─", ctx.W)}
${ctx.totalsStr}
${line("═", ctx.W)}
  Effective tax rate: ${pct(taxRate)}${rrspSummary}`;
    },
  );
