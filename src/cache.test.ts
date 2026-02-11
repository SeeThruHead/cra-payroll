import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { ok, err } from "neverthrow";
import { withCache, cacheKey } from "./cache";
import type { PayrollConfig, PayrollResult, PayrollService } from "./types";

// ── Fixtures ────────────────────────────────────────────────

const BASE_CONFIG: PayrollConfig = {
  province: "Ontario",
  annualSalary: 100_000,
  payPeriod: "Semi-monthly (24 pay periods a year)",
  year: 2026,
  rrspMatchPercent: 4,
  rrspUnmatchedPercent: 0,
  cppMaxedOut: false,
  eiMaxedOut: false,
};

const RESULT: PayrollResult = {
  grossIncome: 4166.67,
  rrspMatched: 166.67,
  rrspUnmatched: 0,
  rrspEmployer: 166.67,
  federalTax: 521.11,
  provincialTax: 264.24,
  cpp: 249.16,
  cpp2: 0,
  ei: 67.92,
  totalDeductions: 1269.10,
  net: 2897.57,
};

// ── Helpers ─────────────────────────────────────────────────

const countingService = (): { service: PayrollService; callCount: () => number } => {
  let calls = 0;
  return {
    service: {
      calculate: async () => {
        calls++;
        return ok(RESULT);
      },
    },
    callCount: () => calls,
  };
};

const failingService: PayrollService = {
  calculate: async () => err("CRA is down"),
};

// ── Test setup ──────────────────────────────────────────────

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(resolve(tmpdir(), "cra-cache-test-"));
});

afterAll(() => {
  // Clean up all temp dirs matching our prefix
  try {
    const tmp = tmpdir();
    for (const entry of readdirSync(tmp)) {
      if (entry.startsWith("cra-cache-test-")) {
        rmSync(resolve(tmp, entry), { recursive: true, force: true });
      }
    }
  } catch {}
});

// ── Tests ───────────────────────────────────────────────────

describe("cache", () => {
  test("first call is a miss — hits inner service", async () => {
    const { service, callCount } = countingService();
    const cached = withCache(service, cacheDir);

    const result = await cached.calculate(BASE_CONFIG, false);

    expect(result.isOk()).toBe(true);
    expect(callCount()).toBe(1);
  });

  test("second call is a hit — skips inner service", async () => {
    const { service, callCount } = countingService();
    const cached = withCache(service, cacheDir);

    await cached.calculate(BASE_CONFIG, false);
    const result = await cached.calculate(BASE_CONFIG, false);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().grossIncome).toBe(RESULT.grossIncome);
    expect(callCount()).toBe(1);
  });

  test("different configs get different cache entries", async () => {
    const { service, callCount } = countingService();
    const cached = withCache(service, cacheDir);

    await cached.calculate(BASE_CONFIG, false);
    await cached.calculate({ ...BASE_CONFIG, annualSalary: 200_000 }, false);

    expect(callCount()).toBe(2);
    expect(readdirSync(cacheDir).length).toBe(2);
  });

  test("writes a valid JSON file to cache dir", async () => {
    const { service } = countingService();
    const cached = withCache(service, cacheDir);

    await cached.calculate(BASE_CONFIG, false);

    const files = readdirSync(cacheDir);
    expect(files.length).toBe(1);
    expect(files[0]).toEndWith(".json");

    const data = JSON.parse(readFileSync(resolve(cacheDir, files[0]), "utf-8"));
    expect(data.grossIncome).toBe(RESULT.grossIncome);
    expect(data.net).toBe(RESULT.net);
  });

  test("does not cache errors", async () => {
    const cached = withCache(failingService, cacheDir);

    const result = await cached.calculate(BASE_CONFIG, false);

    expect(result.isErr()).toBe(true);
    expect(readdirSync(cacheDir).length).toBe(0);
  });

  test("survives corrupted cache file — falls through to service", async () => {
    const { service, callCount } = countingService();
    const cached = withCache(service, cacheDir);

    // Write garbage to the expected cache path
    mkdirSync(cacheDir, { recursive: true });
    const key = cacheKey(BASE_CONFIG);
    writeFileSync(resolve(cacheDir, `${key}.json`), "not json{{{");

    const result = await cached.calculate(BASE_CONFIG, false);

    expect(result.isOk()).toBe(true);
    expect(callCount()).toBe(1);
  });

  test("survives cache file with wrong shape — falls through to service", async () => {
    const { service, callCount } = countingService();
    const cached = withCache(service, cacheDir);

    mkdirSync(cacheDir, { recursive: true });
    const key = cacheKey(BASE_CONFIG);
    writeFileSync(resolve(cacheDir, `${key}.json`), JSON.stringify({ foo: "bar" }));

    const result = await cached.calculate(BASE_CONFIG, false);

    expect(result.isOk()).toBe(true);
    expect(callCount()).toBe(1);
  });

  test("cacheKey is stable for same config", () => {
    const a = cacheKey(BASE_CONFIG);
    const b = cacheKey({ ...BASE_CONFIG });
    expect(a).toBe(b);
  });

  test("cacheKey differs when any field changes", () => {
    const base = cacheKey(BASE_CONFIG);
    expect(cacheKey({ ...BASE_CONFIG, annualSalary: 99_999 })).not.toBe(base);
    expect(cacheKey({ ...BASE_CONFIG, province: "Alberta" })).not.toBe(base);
    expect(cacheKey({ ...BASE_CONFIG, cppMaxedOut: true })).not.toBe(base);
    expect(cacheKey({ ...BASE_CONFIG, rrspMatchPercent: 5 })).not.toBe(base);
    expect(cacheKey({ ...BASE_CONFIG, rrspUnmatchedPercent: 2 })).not.toBe(base);
    expect(cacheKey({ ...BASE_CONFIG, year: 2025 })).not.toBe(base);
  });
});
