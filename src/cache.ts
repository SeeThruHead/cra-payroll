/**
 * Filesystem cache for CRA payroll results.
 * Stores results in ~/.config/cra-payroll/cache/<hash>.json
 */
import { resolve } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { ok, err, type Result } from "neverthrow";
import type { PayrollConfig, PayrollResult, PayrollService } from "./types";
import { log } from "./browser";

const DEFAULT_CACHE_DIR = resolve(process.env.HOME || "~", ".config", "cra-payroll", "cache");

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

export const cacheKey = (config: PayrollConfig): string => {
  const data = JSON.stringify({
    province: config.province,
    annualSalary: config.annualSalary,
    payPeriod: config.payPeriod,
    year: config.year,
    rrspMatchPercent: config.rrspMatchPercent,
    rrspUnmatchedPercent: config.rrspUnmatchedPercent,
    cppMaxedOut: config.cppMaxedOut,
    eiMaxedOut: config.eiMaxedOut,
  });
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
};

const cachePath = (config: PayrollConfig, dir: string): string =>
  resolve(dir, `${cacheKey(config)}.json`);

const readCache = (config: PayrollConfig, dir: string): PayrollResult | null => {
  const path = cachePath(config, dir);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof data.grossIncome === "number" && typeof data.net === "number") {
      return data as PayrollResult;
    }
    return null;
  } catch {
    return null;
  }
};

const writeCache = (config: PayrollConfig, result: PayrollResult, dir: string): void => {
  try {
    ensureDir(dir);
    writeFileSync(cachePath(config, dir), JSON.stringify(result, null, 2));
  } catch (e: any) {
    log(`cache write failed: ${e.message}`);
  }
};

/** Wraps a PayrollService with filesystem caching */
export const withCache = (inner: PayrollService, cacheDir: string = DEFAULT_CACHE_DIR): PayrollService => ({
  calculate: async (config, headless) => {
    const cached = readCache(config, cacheDir);
    if (cached) {
      log(`cache hit: ${cachePath(config, cacheDir)}`);
      return ok(cached);
    }
    log(`cache miss, hitting CRA...`);
    const result = await inner.calculate(config, headless);
    if (result.isOk()) {
      writeCache(config, result.value, cacheDir);
    }
    return result;
  },
});

export { DEFAULT_CACHE_DIR as CACHE_DIR };
