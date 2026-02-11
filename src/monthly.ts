/**
 * Groups pay-period rows into calendar months.
 *
 * Assumes employment starts Jan 1 of the given year.
 * Generates actual pay dates for each frequency to determine
 * which month each pay period falls in.
 */
import * as R from "remeda";
import type { PayPeriodRow, YearlyResult } from "./yearly";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthlyRow {
  month: string;
  periods: number;
  grossIncome: number;
  rrspMatched: number;
  rrspUnmatched: number;
  rrspEmployer: number;
  federalTax: number;
  provincialTax: number;
  cpp: number;
  cpp2: number;
  ei: number;
  totalDeductions: number;
  netPay: number;
}

export interface MonthlyResult {
  rows: MonthlyRow[];
  totals: YearlyResult["totals"];
}

// ── Pay date generation ─────────────────────────────────────

const isWeekday = (d: Date): boolean => {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
};

const nextWeekday = (d: Date): Date => {
  const next = new Date(d);
  while (!isWeekday(next)) next.setDate(next.getDate() + 1);
  return next;
};

const addDays = (d: Date, n: number): Date => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

/**
 * Daily: every weekday starting Jan 1.
 */
const dailyPayMonths = (year: number, count: number): number[] => {
  const months = new Array(12).fill(0);
  let d = nextWeekday(new Date(year, 0, 1));
  for (let i = 0; i < count; i++) {
    months[d.getMonth()]++;
    d = nextWeekday(addDays(d, 1));
  }
  return months;
};

/**
 * Weekly/biweekly: first pay date is the first Friday on or after Jan 1,
 * then every N weeks.
 */
const weeklyPayMonths = (year: number, count: number, everyNWeeks: number): number[] => {
  const months = new Array(12).fill(0);
  // Find first Friday on or after Jan 1
  let d = new Date(year, 0, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  for (let i = 0; i < count; i++) {
    months[d.getMonth()]++;
    d = addDays(d, 7 * everyNWeeks);
  }
  return months;
};

/**
 * Semi-monthly: always 2 per month (1st and 15th).
 */
const semiMonthlyPayMonths = (): number[] => new Array(12).fill(2);

/**
 * Monthly: always 1 per month.
 */
const monthlyPayMonths = (): number[] => new Array(12).fill(1);

/**
 * For unusual periods (10, 13, 22), distribute as evenly as possible,
 * putting extras in the earliest months.
 */
const evenPayMonths = (count: number): number[] => {
  const base = Math.floor(count / 12);
  const extra = count % 12;
  return R.range(0, 12).map(i => base + (i < extra ? 1 : 0));
};

/**
 * Returns an array of 12 numbers: how many pay periods fall in each month.
 */
export const periodsPerMonth = (year: number, payPeriod: string, totalPeriods: number): number[] => {
  if (payPeriod.includes("Daily")) return dailyPayMonths(year, totalPeriods);
  if (payPeriod.includes("Semi-monthly")) return semiMonthlyPayMonths();
  if (payPeriod.startsWith("Monthly")) return monthlyPayMonths();
  if (payPeriod.includes("Biweekly")) return weeklyPayMonths(year, totalPeriods, 2);
  if (payPeriod.includes("Weekly")) return weeklyPayMonths(year, totalPeriods, 1);
  return evenPayMonths(totalPeriods);
};

// ── Grouping ────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

const sumRows = (rows: PayPeriodRow[]): Omit<MonthlyRow, "month" | "periods"> => ({
  grossIncome: round2(R.sumBy(rows, r => r.grossIncome)),
  rrspMatched: round2(R.sumBy(rows, r => r.rrspMatched)),
  rrspUnmatched: round2(R.sumBy(rows, r => r.rrspUnmatched)),
  rrspEmployer: round2(R.sumBy(rows, r => r.rrspEmployer)),
  federalTax: round2(R.sumBy(rows, r => r.federalTax)),
  provincialTax: round2(R.sumBy(rows, r => r.provincialTax)),
  cpp: round2(R.sumBy(rows, r => r.cpp)),
  cpp2: round2(R.sumBy(rows, r => r.cpp2)),
  ei: round2(R.sumBy(rows, r => r.ei)),
  totalDeductions: round2(R.sumBy(rows, r => r.totalDeductions)),
  netPay: round2(R.sumBy(rows, r => r.netPay)),
});

export const groupByMonth = (
  yearly: YearlyResult,
  year: number,
  payPeriod: string,
  totalPeriods: number,
): MonthlyResult => {
  const distribution = periodsPerMonth(year, payPeriod, totalPeriods);

  let offset = 0;
  const rows: MonthlyRow[] = distribution.map((count, i) => {
    const chunk = yearly.rows.slice(offset, offset + count);
    offset += count;
    return {
      month: MONTH_NAMES[i],
      periods: count,
      ...sumRows(chunk),
    };
  });

  return { rows, totals: yearly.totals };
};
