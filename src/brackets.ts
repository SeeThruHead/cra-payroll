/**
 * Federal and provincial marginal tax rate brackets.
 *
 * Keyed by year. Add new entries as bracket tables are published.
 * Each function takes taxable income, returns marginal rate as a decimal.
 */
import { ok, err, type Result } from "neverthrow";

type RateFn = (taxableIncome: number) => number;

interface YearRates {
  federal: RateFn;
  provincial: Record<string, RateFn>;
}

// ── Constructors ────────────────────────────────────────────

/** Simple bracket lookup: [[upTo, rate], ...] rate applies for income up to that threshold. */
const brackets = (...bands: [number, number][]): RateFn => (income) =>
  (bands.find(([upTo]) => income <= upTo) ?? bands[bands.length - 1])[1];

/** Compute cumulative tax from bracket bands (for surtax calculations). */
const cumulativeTax = (bands: [number, number][]) => (income: number): number =>
  bands.reduce(
    ({ tax, prev }, [cap, rate]) => ({
      tax: income > prev ? tax + (Math.min(income, cap) - prev) * rate : tax,
      prev: cap,
    }),
    { tax: 0, prev: 0 },
  ).tax;

/** Wraps a base rate function with Ontario-style surtax. */
const withSurtax = (
  baseFn: RateFn,
  taxFn: (income: number) => number,
  threshold1: number,
  threshold2: number,
): RateFn => (income) => {
  const rate = baseFn(income);
  const tax = taxFn(income);
  let mult = 1;
  if (tax > threshold1) mult += 0.20;
  if (tax > threshold2) mult += 0.36;
  return rate * mult;
};

// ── Rate map ────────────────────────────────────────────────

const on2025bands: [number, number][] = [[52_886, 0.0505], [105_775, 0.0915], [150_000, 0.1116], [220_000, 0.1216], [Infinity, 0.1316]];
const on2026bands: [number, number][] = [[54_000, 0.0505], [108_000, 0.0915], [150_000, 0.1116], [220_000, 0.1216], [Infinity, 0.1316]];

const RATES: Record<number, YearRates> = {
  2025: {
    federal: brackets([57_375, 0.15], [114_750, 0.205], [158_468, 0.26], [220_000, 0.29], [Infinity, 0.33]),
    provincial: {
      Ontario: withSurtax(brackets(...on2025bands), cumulativeTax(on2025bands), 4_991, 6_387),
      Alberta: brackets([148_269, 0.10], [177_922, 0.12], [237_230, 0.13], [355_845, 0.14], [Infinity, 0.15]),
      "British Columbia": brackets([47_937, 0.0506], [95_875, 0.077], [110_076, 0.105], [133_664, 0.1229], [181_232, 0.147], [252_752, 0.168], [Infinity, 0.205]),
    },
  },
  2026: {
    federal: brackets([59_000, 0.15], [118_000, 0.205], [163_000, 0.26], [227_000, 0.29], [Infinity, 0.33]),
    provincial: {
      Ontario: withSurtax(brackets(...on2026bands), cumulativeTax(on2026bands), 5_100, 6_525),
      Alberta: brackets([152_000, 0.10], [182_000, 0.12], [243_000, 0.13], [365_000, 0.14], [Infinity, 0.15]),
      "British Columbia": brackets([49_000, 0.0506], [98_000, 0.077], [113_000, 0.105], [137_000, 0.1229], [186_000, 0.147], [259_000, 0.168], [Infinity, 0.205]),
    },
  },
};

// ── Public API ──────────────────────────────────────────────

export const supportedYears = (): number[] => Object.keys(RATES).map(Number);

export const hasBrackets = (year: number, province: string): boolean =>
  RATES[year] !== undefined && RATES[year].provincial[province] !== undefined;

export const marginalRate = (
  year: number,
  province: string,
  taxableIncome: number,
): Result<{ federal: number; provincial: number; combined: number }, string> => {
  const yearRates = RATES[year];
  if (!yearRates) return err(`No tax bracket data for ${year}. Supported years: ${supportedYears().join(", ")}`);

  const provFn = yearRates.provincial[province];
  if (!provFn) return err(`No provincial bracket data for ${province} in ${year}. Supported: ${Object.keys(yearRates.provincial).join(", ")}`);

  const fed = yearRates.federal(taxableIncome);
  const prov = provFn(taxableIncome);
  return ok({ federal: fed, provincial: prov, combined: fed + prov });
};
