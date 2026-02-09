import * as R from "remeda";
import { money, line } from "./format";
import type { YearlyResult, PayPeriodRow } from "../yearly";

interface Column {
  label: string;
  row: (r: PayPeriodRow) => number;
  total: (t: YearlyResult["totals"], takeHome: number) => number | null;
}

function buildColumns(hasRrsp: boolean): Column[] {
  const cols: Column[] = [
    { label: "Gross",    row: r => r.grossIncome,   total: t => t.grossIncome },
    { label: "Fed Tax",  row: r => r.federalTax,    total: t => t.federalTax },
    { label: "Prov Tax", row: r => r.provincialTax, total: t => t.provincialTax },
    { label: "CPP",      row: r => r.cpp,           total: t => t.cpp },
    { label: "CPP2",     row: r => r.cpp2,          total: t => t.cpp2 },
    { label: "EI",       row: r => r.ei,            total: t => t.ei },
    { label: "Net Pay",  row: r => r.netPay,        total: t => t.netPay },
  ];

  if (hasRrsp) {
    cols.push(
      { label: "RRSP Emp",  row: r => r.rrspEmployee,                total: t => t.rrspEmployee },
      { label: "Take Home", row: r => r.netPay - r.rrspEmployee,     total: (t, th) => th },
    );
  }

  cols.push({
    label: "Cum CPP/EI",
    row: r => r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi,
    total: () => null,
  });

  return cols;
}

function colWidth(col: Column, totals: YearlyResult["totals"], takeHome: number): number {
  const totalVal = col.total(totals, takeHome);
  return Math.max(col.label.length, totalVal !== null ? money(totalVal).length : 0);
}

function annotateRow(r: PayPeriodRow, firstRow: PayPeriodRow): string {
  if (r.cpp === 0 && r.cpp2 === 0 && r.ei === 0) return " ✓ maxed";
  if (r.cpp < firstRow.cpp || r.ei < firstRow.ei) return " ← partial";
  return "";
}

export function renderTable(yearly: YearlyResult, periodsPerYear: number): string {
  const { rows, totals } = yearly;
  const hasRrsp = totals.rrspEmployee > 0 || totals.rrspEmployer > 0;
  const takeHome = totals.netPay - totals.rrspEmployee;
  const columns = buildColumns(hasRrsp);

  const widths = R.map(columns, col => colWidth(col, totals, takeHome));

  const pad = (s: string, w: number) => s.padStart(w);
  const fmtCol = (n: number, w: number) => pad(money(n), w);

  const headerCells = ["  #  ", ...R.map(R.zip(columns, widths), ([col, w]) => pad(col.label, w))];
  const headerLine = headerCells.join(" │ ");
  const W = headerLine.length;

  const lines: string[] = [
    "Per-Paycheck Table (2026)",
    line("═", W),
    headerLine,
    line("─", W),
  ];

  for (const r of rows) {
    const cells = [
      ` ${String(r.period).padStart(3)} `,
      ...R.map(R.zip(columns, widths), ([col, w]) => fmtCol(col.row(r), w)),
    ];
    // Add annotation to last cell
    const annotation = annotateRow(r, rows[0]);
    const lastIdx = cells.length - 1;
    cells[lastIdx] += annotation;
    lines.push(cells.join(" │ "));
  }

  lines.push(line("─", W));

  const totCells = [
    " TOT ",
    ...R.map(R.zip(columns, widths), ([col, w]) => {
      const val = col.total(totals, takeHome);
      return val !== null ? fmtCol(val, w) : pad("", w);
    }),
  ];
  lines.push(totCells.join(" │ "));
  lines.push(line("═", W));

  if (hasRrsp) {
    const perPeriod = money(totals.rrspEmployer / periodsPerYear);
    lines.push("");
    lines.push(`  RRSP (Employer match): $${money(totals.rrspEmployer)}/yr ($${perPeriod}/period)`);
  }

  return lines.join("\n");
}
