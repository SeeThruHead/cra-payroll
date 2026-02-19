import { describe, test, expect, mock, afterAll } from "bun:test";
import { rrspOptimizerService, rrspOptimizerServiceNoCache, type RrspOptimizerConfig } from "./rrsp-optimizer";

// ── Parsing tests (use the real service for a live integration test) ──

const baseConfig: RrspOptimizerConfig = {
  year: 2026,
  province: "Ontario",
  income: 200000,
  rrspRoom: 50000,
  numKids5AndYounger: 0,
  numKids6AndOlder: 0,
  hasSpouse: false,
  spouseIncome: null,
};

describe("rrspOptimizerService", () => {
  test("fetches and parses results from rrspcontribution.ca", async () => {
    const result = await rrspOptimizerServiceNoCache.optimize(baseConfig);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const r = result.value;
    expect(r.recommendedContribution).toBeGreaterThan(0);
    expect(r.totalSavings).toBeGreaterThan(0);
    expect(r.savingsPercent).toBeGreaterThan(0);
    expect(r.savingsPercent).toBeLessThan(1);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.benefitsIncluded.length).toBeGreaterThan(0);
  });

  test("steps have valid structure", async () => {
    const result = await rrspOptimizerService.optimize(baseConfig);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    for (const step of result.value.steps) {
      expect(step.step).toBeGreaterThan(0);
      expect(step.stepSize).toBeGreaterThan(0);
      expect(step.cumulativeContribution).toBeGreaterThan(0);
      expect(step.effectiveTaxRate).toBeGreaterThan(0);
      expect(step.effectiveTaxRate).toBeLessThan(1);
      expect(step.cumulativeSavings).toBeGreaterThan(0);
      expect(typeof step.event).toBe("string");
    }
  });

  test("steps are ordered and cumulative", async () => {
    const result = await rrspOptimizerService.optimize(baseConfig);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const steps = result.value.steps;
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].step).toBe(steps[i - 1].step + 1);
      expect(steps[i].cumulativeContribution).toBeGreaterThan(steps[i - 1].cumulativeContribution);
      expect(steps[i].cumulativeSavings).toBeGreaterThan(steps[i - 1].cumulativeSavings);
    }
  });

  test("last step cumulative matches recommendation", async () => {
    const result = await rrspOptimizerService.optimize(baseConfig);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const lastStep = result.value.steps[result.value.steps.length - 1];
    expect(lastStep.cumulativeContribution).toBe(result.value.recommendedContribution);
    expect(lastStep.cumulativeSavings).toBe(result.value.totalSavings);
  });

  test("works with different provinces", async () => {
    const result = await rrspOptimizerServiceNoCache.optimize({ ...baseConfig, province: "Alberta" });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.recommendedContribution).toBeGreaterThan(0);
  });

  test("works with spouse and kids", async () => {
    const result = await rrspOptimizerServiceNoCache.optimize({
      ...baseConfig,
      numKids5AndYounger: 2,
      hasSpouse: true,
      spouseIncome: 50000,
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.recommendedContribution).toBeGreaterThan(0);
  });

  test("cache hit returns same result", async () => {
    // First call populates cache
    const r1 = await rrspOptimizerService.optimize(baseConfig);
    expect(r1.isOk()).toBe(true);

    // Second call should be a cache hit
    const r2 = await rrspOptimizerService.optimize(baseConfig);
    expect(r2.isOk()).toBe(true);

    if (r1.isOk() && r2.isOk()) {
      expect(r2.value).toEqual(r1.value);
    }
  });
});
