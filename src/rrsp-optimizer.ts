/**
 * RRSP Contribution Optimizer — hits rrspcontribution.ca for METR-based advice.
 *
 * Unlike the CRA PDOC (which needs a browser), this is a simple HTTP POST
 * that returns server-rendered HTML. No Puppeteer needed.
 */
import { ok, err, type Result } from "neverthrow";
import { resolve } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { log } from "./browser";

// ── Types ───────────────────────────────────────────────────

export interface RrspOptimizerConfig {
  year: number;
  province: string;
  income: number;
  rrspRoom: number;
  numKids5AndYounger: number;
  numKids6AndOlder: number;
  hasSpouse: boolean;
  spouseIncome: number | null;
}

export interface RrspStep {
  step: number;
  stepSize: number;
  cumulativeContribution: number;
  effectiveTaxRate: number;   // decimal, e.g. 0.535
  cumulativeSavings: number;
  event: string;
}

export interface RrspOptimizerResult {
  recommendedContribution: number;
  totalSavings: number;
  savingsPercent: number;     // decimal, e.g. 0.499
  steps: RrspStep[];
  benefitsIncluded: string[];
}

export interface RrspOptimizerService {
  optimize(config: RrspOptimizerConfig): Promise<Result<RrspOptimizerResult, string>>;
}

// ── Province mapping ────────────────────────────────────────

const PROVINCE_CODES: Record<string, string> = {
  "Alberta": "ab",
  "British Columbia": "bc",
  "Manitoba": "mb",
  "New Brunswick": "nb",
  "Newfoundland and Labrador": "nl",
  "Newfoundland": "nl",
  "Nova Scotia": "ns",
  "Ontario": "on",
  "Prince Edward Island": "pe",
  "Quebec": "qc",
  "Saskatchewan": "sk",
  "Northwest Territories": "nt",
  "Nunavut": "nu",
  "Yukon": "yt",
};

const resolveProvinceCode = (province: string): Result<string, string> => {
  // Already a code?
  if (Object.values(PROVINCE_CODES).includes(province.toLowerCase())) return ok(province.toLowerCase());
  const code = PROVINCE_CODES[province];
  if (code) return ok(code);
  return err(`Unknown province "${province}". Supported: ${Object.keys(PROVINCE_CODES).join(", ")}`);
};

// ── HTTP client ─────────────────────────────────────────────

const RRSP_URL = "https://www.rrspcontribution.ca/submit";

const buildFormBody = (config: RrspOptimizerConfig, provinceCode: string): string => {
  const params = new URLSearchParams();
  params.set("year", String(config.year));
  params.set("province", provinceCode);
  params.set("income", String(config.income));
  params.set("rrsp_room", String(config.rrspRoom));
  params.set("num_kids_5_and_younger", String(config.numKids5AndYounger));
  params.set("num_kids_6_and_older", String(config.numKids6AndOlder));
  if (config.hasSpouse) params.set("spouse", "y");
  if (config.spouseIncome !== null) params.set("spouse_income", String(config.spouseIncome));
  return params.toString();
};

const fetchResults = async (config: RrspOptimizerConfig): Promise<Result<string, string>> => {
  const provinceCode = resolveProvinceCode(config.province);
  if (provinceCode.isErr()) return err(provinceCode.error);

  const body = buildFormBody(config, provinceCode.value);
  log(`RRSP optimizer POST: ${body}`);

  try {
    const response = await fetch(RRSP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return err(`HTTP ${response.status}: ${response.statusText}`);
    return ok(await response.text());
  } catch (e: any) {
    return err(`Network error: ${e.message}`);
  }
};

// ── HTML parser ─────────────────────────────────────────────

const parseRecommendation = (html: string): Result<{ contribution: number; savings: number; savingsPercent: number }, string> => {
  // "contribute $50,000" or "contribute $4,518"
  const contMatch = html.match(/contribute\s+\$\s*([\d,]+)/i);
  // "savings of $24,968"
  const savMatch = html.match(/savings\s+of\s+\$\s*([\d,]+)/i);
  // "49.9%" or "53.5%"
  const pctMatch = html.match(/([\d.]+)\s*%\s*<\/b>\s*of your contribution/i);

  if (!contMatch) return err("Could not parse recommended contribution from response");
  if (!savMatch) return err("Could not parse savings amount from response");

  const contribution = parseFloat(contMatch[1].replace(/,/g, ""));
  const savings = parseFloat(savMatch[1].replace(/,/g, ""));
  const savingsPercent = pctMatch ? parseFloat(pctMatch[1]) / 100 : savings / contribution;

  return ok({ contribution, savings, savingsPercent });
};

const parseStepsTable = (html: string): RrspStep[] => {
  const steps: RrspStep[] = [];
  // Find all <td> groups after the header
  const tableMatch = html.match(/<table class="table table-striped">([\s\S]*?)<\/table>/);
  if (!tableMatch) return steps;

  const tableHtml = tableMatch[1];
  const rows = tableHtml.split(/<tr>/g).slice(2); // skip the empty first split + header row

  for (const row of rows) {
    const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1].trim());
    if (cells.length < 6) continue;

    steps.push({
      step: parseInt(cells[0], 10),
      stepSize: parseFloat(cells[1].replace(/[$,]/g, "")),
      cumulativeContribution: parseFloat(cells[2].replace(/[$,]/g, "")),
      effectiveTaxRate: parseFloat(cells[3].replace(/%/, "")) / 100,
      cumulativeSavings: parseFloat(cells[4].replace(/[$,]/g, "")),
      event: cells[5].replace(/=&gt;/g, "→").replace(/<[^>]*>/g, "").trim(),
    });
  }

  return steps;
};

const parseBenefits = (html: string): string[] => {
  const section = html.match(/government benefits and tax credits are included:[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/);
  if (!section) return [];
  return [...section[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
    .map(m => m[1].trim())
    .filter(Boolean);
};

const parseHtml = (html: string): Result<RrspOptimizerResult, string> => {
  const rec = parseRecommendation(html);
  if (rec.isErr()) return err(rec.error);

  const steps = parseStepsTable(html);
  const benefits = parseBenefits(html);

  return ok({
    recommendedContribution: rec.value.contribution,
    totalSavings: rec.value.savings,
    savingsPercent: rec.value.savingsPercent,
    steps,
    benefitsIncluded: benefits,
  });
};

// ── Cache ───────────────────────────────────────────────────

const CACHE_DIR = resolve(process.env.HOME || "~", ".config", "cra-payroll", "cache", "rrsp");

const cacheKey = (config: RrspOptimizerConfig): string => {
  const data = JSON.stringify({
    year: config.year,
    province: config.province,
    income: config.income,
    rrspRoom: config.rrspRoom,
    numKids5AndYounger: config.numKids5AndYounger,
    numKids6AndOlder: config.numKids6AndOlder,
    hasSpouse: config.hasSpouse,
    spouseIncome: config.spouseIncome,
  });
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
};

const cachePath = (config: RrspOptimizerConfig): string =>
  resolve(CACHE_DIR, `${cacheKey(config)}.json`);

const readCache = (config: RrspOptimizerConfig): RrspOptimizerResult | null => {
  const path = cachePath(config);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof data.recommendedContribution === "number") return data as RrspOptimizerResult;
    return null;
  } catch { return null; }
};

const writeCache = (config: RrspOptimizerConfig, result: RrspOptimizerResult): void => {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(config), JSON.stringify(result, null, 2));
  } catch (e: any) {
    log(`RRSP cache write failed: ${e.message}`);
  }
};

// ── Service ─────────────────────────────────────────────────

const rawOptimize = async (config: RrspOptimizerConfig): Promise<Result<RrspOptimizerResult, string>> => {
  const html = await fetchResults(config);
  if (html.isErr()) return err(html.error);
  return parseHtml(html.value);
};

const cachedOptimize = async (config: RrspOptimizerConfig): Promise<Result<RrspOptimizerResult, string>> => {
  const cached = readCache(config);
  if (cached) {
    log(`RRSP cache hit: ${cachePath(config)}`);
    return ok(cached);
  }
  log("RRSP cache miss, hitting rrspcontribution.ca...");
  const result = await rawOptimize(config);
  if (result.isOk()) writeCache(config, result.value);
  return result;
};

export const rrspOptimizerService: RrspOptimizerService = { optimize: cachedOptimize };
export const rrspOptimizerServiceNoCache: RrspOptimizerService = { optimize: rawOptimize };
