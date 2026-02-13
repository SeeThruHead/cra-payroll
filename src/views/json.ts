/**
 * Structured JSON output for machine consumption.
 */
import type { PayrollConfig, PayrollResult } from "../types";
import type { YearlyResult } from "../yearly";
import type { MonthlyResult } from "../monthly";

export type JsonOutputMode = "single" | "table" | "month-table" | "annual" | "monthly";

interface JsonSingleOutput {
  mode: "single";
  config: PayrollConfig;
  result: PayrollResult;
}

interface JsonTableOutput {
  mode: "table";
  config: PayrollConfig;
  yearly: YearlyResult;
}

interface JsonMonthTableOutput {
  mode: "month-table";
  config: PayrollConfig;
  monthly: MonthlyResult;
}

interface JsonAnnualOutput {
  mode: "annual";
  config: PayrollConfig;
  totals: YearlyResult["totals"];
}

interface JsonMonthlyOutput {
  mode: "monthly";
  config: PayrollConfig;
  averages: {
    [K in keyof YearlyResult["totals"]]: number;
  };
}

export type JsonOutput =
  | JsonSingleOutput
  | JsonTableOutput
  | JsonMonthTableOutput
  | JsonAnnualOutput
  | JsonMonthlyOutput;

export const buildJsonSingle = (config: PayrollConfig, result: PayrollResult): JsonSingleOutput => ({
  mode: "single",
  config,
  result,
});

export const buildJsonTable = (config: PayrollConfig, yearly: YearlyResult): JsonTableOutput => ({
  mode: "table",
  config,
  yearly,
});

export const buildJsonMonthTable = (config: PayrollConfig, monthly: MonthlyResult): JsonMonthTableOutput => ({
  mode: "month-table",
  config,
  monthly,
});

export const buildJsonAnnual = (config: PayrollConfig, totals: YearlyResult["totals"]): JsonAnnualOutput => ({
  mode: "annual",
  config,
  totals,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

const divideAll = (totals: YearlyResult["totals"], divisor: number): YearlyResult["totals"] => ({
  grossIncome: round2(totals.grossIncome / divisor),
  rrspMatched: round2(totals.rrspMatched / divisor),
  rrspUnmatched: round2(totals.rrspUnmatched / divisor),
  rrspEmployer: round2(totals.rrspEmployer / divisor),
  federalTax: round2(totals.federalTax / divisor),
  provincialTax: round2(totals.provincialTax / divisor),
  cpp: round2(totals.cpp / divisor),
  cpp2: round2(totals.cpp2 / divisor),
  ei: round2(totals.ei / divisor),
  totalDeductions: round2(totals.totalDeductions / divisor),
  netPay: round2(totals.netPay / divisor),
});

export const buildJsonMonthly = (config: PayrollConfig, totals: YearlyResult["totals"]): JsonMonthlyOutput => ({
  mode: "monthly",
  config,
  averages: divideAll(totals, 12),
});

export const buildJsonOutput = (
  mode: JsonOutputMode,
  config: PayrollConfig,
  data: { single?: PayrollResult; yearly?: YearlyResult; monthly?: MonthlyResult },
): JsonOutput => {
  switch (mode) {
    case "single":
      return buildJsonSingle(config, data.single!);
    case "table":
      return buildJsonTable(config, data.yearly!);
    case "month-table":
      return buildJsonMonthTable(config, data.monthly!);
    case "annual":
      return buildJsonAnnual(config, data.yearly!.totals);
    case "monthly":
      return buildJsonMonthly(config, data.yearly!.totals);
  }
};
