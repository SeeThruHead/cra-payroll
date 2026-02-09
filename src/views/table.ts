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

const col = (v: number | string, w: number) =>
  typeof v === "number" ? money(v).padStart(w) : v.padStart(w);

const renderRow = (r: Row): string =>
  `${r.label} │ ${col(r.gross, 10)} │ ${col(r.fedTax, 10)} │ ${col(r.provTax, 10)} │ ${col(r.cpp, 10)} │ ${col(r.cpp2, 6)} │ ${col(r.ei, 10)} │ ${col(r.netPay, 10)}${r.rrspEmp !== undefined ? ` │ ${col(r.rrspEmp, 10)} │ ${col(r.takeHome!, 10)}` : ""} │ ${col(r.cumCppEi, 10)}${r.suffix ?? ""}`;

const showRrsp = (totals: YearlyResult["totals"]) =>
  totals.rrspEmployee > 0 || totals.rrspEmployer > 0;

const rrspFields = (show: boolean, fields: Record<string, number | string>) =>
  show ? fields : {};

const annotate = (r: PayPeriodRow, first: PayPeriodRow): string =>
  r.cpp === 0 && r.cpp2 === 0 && r.ei === 0 ? " ✓ maxed"
    : r.cpp < first.cpp || r.ei < first.ei ? " ← partial"
    : "";

const toRow = (r: PayPeriodRow, first: PayPeriodRow, rrsp: boolean): Row => ({
  label: ` ${String(r.period).padStart(3)} `,
  gross: r.grossIncome, fedTax: r.federalTax, provTax: r.provincialTax,
  cpp: r.cpp, cpp2: r.cpp2, ei: r.ei, netPay: r.netPay,
  ...rrspFields(rrsp, { rrspEmp: r.rrspEmployee, takeHome: r.netPay - r.rrspEmployee }),
  cumCppEi: r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi,
  suffix: annotate(r, first),
});

const headerRow = (rrsp: boolean): Row => ({
  label: "  #  ",
  gross: "Gross", fedTax: "Fed Tax", provTax: "Prov Tax",
  cpp: "CPP", cpp2: "CPP2", ei: "EI", netPay: "Net Pay",
  ...rrspFields(rrsp, { rrspEmp: "RRSP Emp", takeHome: "Take Home" }),
  cumCppEi: "Cum CPP/EI",
});

const totalsRow = (totals: YearlyResult["totals"], rrsp: boolean): Row => ({
  label: " TOT ",
  gross: totals.grossIncome, fedTax: totals.federalTax, provTax: totals.provincialTax,
  cpp: totals.cpp, cpp2: totals.cpp2, ei: totals.ei, netPay: totals.netPay,
  ...rrspFields(rrsp, { rrspEmp: totals.rrspEmployee, takeHome: totals.netPay - totals.rrspEmployee }),
  cumCppEi: "",
});

export const renderTable = (yearly: YearlyResult, periodsPerYear: number): string =>
  R.pipe(
    { ...yearly, rrsp: showRrsp(yearly.totals) },
    ctx => ({ ...ctx, header: renderRow(headerRow(ctx.rrsp)) }),
    ctx => ({ ...ctx, totalsStr: renderRow(totalsRow(ctx.totals, ctx.rrsp)) }),
    ctx => ({ ...ctx, W: ctx.header.length }),
    ctx => ({ ...ctx, bodyRows: ctx.rows.map(r => renderRow(toRow(r, ctx.rows[0], ctx.rrsp))) }),
    ctx =>
`Per-Paycheck Table (2026)
${line("═", ctx.W)}
${ctx.header}
${line("─", ctx.W)}
${ctx.bodyRows.join("\n")}
${line("─", ctx.W)}
${ctx.totalsStr}
${line("═", ctx.W)}${
when(ctx.rrsp, `\n  RRSP (Employer match): $${money(ctx.totals.rrspEmployer)}/yr ($${money(ctx.totals.rrspEmployer / periodsPerYear)}/period)`)}`,
  );
