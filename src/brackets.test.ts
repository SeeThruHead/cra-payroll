import { describe, test, expect } from "bun:test";
import { marginalRate, hasBrackets, supportedYears } from "./brackets";

describe("marginalRate", () => {
  test("errors on unsupported year", () => {
    const result = marginalRate(2020, "Ontario", 100_000);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("No tax bracket data for 2020");
  });

  test("errors on unsupported province", () => {
    const result = marginalRate(2026, "Narnia", 100_000);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("No provincial bracket data for Narnia");
  });

  test("Ontario $121k taxable matches ~43.41% combined (2025)", () => {
    const result = marginalRate(2025, "Ontario", 121_000);
    expect(result.isOk()).toBe(true);
    const { federal, provincial, combined } = result._unsafeUnwrap();
    // Federal: 26% bracket ($114,750-$158,468)
    expect(federal).toBeCloseTo(0.26, 2);
    // Ontario: 11.16% * 1.56 (both surtax thresholds exceeded) = 17.41%
    expect(provincial).toBeCloseTo(0.1741, 2);
    // Combined ~43.41%
    expect(combined).toBeCloseTo(0.4341, 2);
  });

  test("low income hits lowest brackets", () => {
    const result = marginalRate(2026, "Ontario", 30_000);
    expect(result.isOk()).toBe(true);
    const { federal, provincial } = result._unsafeUnwrap();
    expect(federal).toBe(0.15);
    expect(provincial).toBe(0.0505);
  });

  test("very high income hits top brackets", () => {
    const result = marginalRate(2026, "Ontario", 500_000);
    expect(result.isOk()).toBe(true);
    const { federal, combined } = result._unsafeUnwrap();
    expect(federal).toBe(0.33);
    expect(combined).toBeGreaterThan(0.50);
  });

  test("higher income has higher or equal marginal rate", () => {
    const low = marginalRate(2026, "Ontario", 60_000)._unsafeUnwrap();
    const mid = marginalRate(2026, "Ontario", 120_000)._unsafeUnwrap();
    const high = marginalRate(2026, "Ontario", 250_000)._unsafeUnwrap();
    expect(mid.combined).toBeGreaterThanOrEqual(low.combined);
    expect(high.combined).toBeGreaterThanOrEqual(mid.combined);
  });

  test("Alberta has no surtax — lower provincial than Ontario at same income", () => {
    const on = marginalRate(2026, "Ontario", 200_000)._unsafeUnwrap();
    const ab = marginalRate(2026, "Alberta", 200_000)._unsafeUnwrap();
    expect(ab.provincial).toBeLessThan(on.provincial);
  });

  test("BC brackets work", () => {
    const result = marginalRate(2026, "British Columbia", 150_000);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().provincial).toBeGreaterThan(0.12);
  });
});

describe("hasBrackets", () => {
  test("returns true for supported year + province", () => {
    expect(hasBrackets(2026, "Ontario")).toBe(true);
    expect(hasBrackets(2025, "Alberta")).toBe(true);
  });

  test("returns false for unsupported year", () => {
    expect(hasBrackets(2020, "Ontario")).toBe(false);
  });

  test("returns false for unsupported province", () => {
    expect(hasBrackets(2026, "Narnia")).toBe(false);
  });
});

describe("supportedYears", () => {
  test("includes 2025 and 2026", () => {
    const years = supportedYears();
    expect(years).toContain(2025);
    expect(years).toContain(2026);
  });
});
