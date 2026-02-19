/**
 * Terminal rendering for RRSP optimizer results.
 */
import { money, line, pct } from "./format";
import type { RrspOptimizerResult, RrspOptimizerConfig } from "../rrsp-optimizer";

const f = (n: number) => money(n).padStart(10);
const W = 80;

export const renderRrspAdvice = (config: RrspOptimizerConfig, result: RrspOptimizerResult): string => {
  const parts: string[] = [];

  // Header
  parts.push("");
  parts.push(`RRSP Contribution Optimizer  (via rrspcontribution.ca)`);
  parts.push(line("─", W));
  parts.push(`Province:      ${config.province}`);
  parts.push(`Year:          ${config.year}`);
  parts.push(`Income:        $${money(config.income)}`);
  parts.push(`RRSP Room:     $${money(config.rrspRoom)}`);
  if (config.numKids5AndYounger > 0) parts.push(`Kids ≤5:       ${config.numKids5AndYounger}`);
  if (config.numKids6AndOlder > 0) parts.push(`Kids 6–17:     ${config.numKids6AndOlder}`);
  if (config.hasSpouse) parts.push(`Spouse Income: ${config.spouseIncome !== null ? `$${money(config.spouseIncome)}` : "N/A"}`);
  parts.push(line("─", W));

  // Recommendation
  parts.push("");
  parts.push(`💡 Recommendation`);
  parts.push(line("═", W));
  parts.push(`  Contribute:   $${f(result.recommendedContribution)}`);
  parts.push(`  Tax Savings:  $${f(result.totalSavings)}  (${pct(result.savingsPercent * 100)} of contribution)`);
  parts.push(line("═", W));

  // Step table
  if (result.steps.length > 0) {
    parts.push("");
    parts.push(`Marginal Effective Tax Rate Breakdown`);
    parts.push(line("─", W));

    const hStep = "Step".padStart(4);
    const hSize = "Step Size".padStart(12);
    const hCum  = "Cumulative".padStart(12);
    const hRate = "METR".padStart(7);
    const hSav  = "Savings".padStart(12);
    const hEvt  = "Event";
    parts.push(`${hStep}  ${hSize}  ${hCum}  ${hRate}  ${hSav}  ${hEvt}`);
    parts.push(line("─", W));

    for (const s of result.steps) {
      const step = String(s.step).padStart(4);
      const size = `$${money(s.stepSize)}`.padStart(12);
      const cum  = `$${money(s.cumulativeContribution)}`.padStart(12);
      const rate = pct(s.effectiveTaxRate * 100).padStart(7);
      const sav  = `$${money(s.cumulativeSavings)}`.padStart(12);
      parts.push(`${step}  ${size}  ${cum}  ${rate}  ${sav}  ${s.event}`);
    }
    parts.push(line("─", W));
  }

  // Benefits footer
  if (result.benefitsIncluded.length > 0) {
    parts.push("");
    parts.push("Includes impact of:");
    for (const b of result.benefitsIncluded) {
      parts.push(`  • ${b}`);
    }
  }

  parts.push("");
  return parts.join("\n");
};
