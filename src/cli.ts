#!/usr/bin/env bun
import { parseArgs } from "util";
import { resolve } from "path";
import { existsSync, readFileSync, fstatSync } from "fs";
import { createInterface } from "readline";
import { calculatePayroll, setVerbose, type PayrollConfig } from "./calculator";
import { calculateYearly, PAY_PERIOD_COUNTS, type YearlyResult } from "./yearly";

const PROVINCES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Nova Scotia",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Northwest Territories",
  "Nunavut",
  "Yukon",
];

const PAY_PERIODS = [
  "Daily (240 pay periods a year)",
  "Weekly (52 pay periods a year)",
  "Biweekly (26 pay periods a year)",
  "Semi-monthly (24 pay periods a year)",
  "Monthly (12 pay periods a year)",
];

// ── Arg parsing ──────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: "string", short: "c", default: "" },
    salary: { type: "string", short: "s" },
    province: { type: "string", short: "p" },
    "pay-period": { type: "string" },
    "rrsp-employee": { type: "string" },
    "rrsp-employer": { type: "string" },
    "cpp-maxed": { type: "boolean", default: false },
    "ei-maxed": { type: "boolean", default: false },
    table: { type: "boolean", short: "t", default: false },
    annual: { type: "boolean", short: "a", default: false },
    monthly: { type: "boolean", short: "m", default: false },
    headless: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
  cra-payroll - Calculate Canadian payroll deductions using CRA's PDOC

  Usage:
    cra-payroll [options]
    cat config.json | cra-payroll
    cra-payroll -c myconfig.json

  Options:
    -c, --config <path>       Path to config file (default: ./config.json or ~/.cra-payroll.json)
    -s, --salary <amount>     Annual salary
    -p, --province <name>     Province of employment
    --pay-period <type>       Pay period (e.g. "Semi-monthly (24 pay periods a year)")
    --rrsp-employee <pct>     Employee RRSP contribution % (default: 4)
    --rrsp-employer <pct>     Employer RRSP match % (default: 4)
    --cpp-maxed               CPP contributions maxed out for the year
    --ei-maxed                EI premiums maxed out for the year
    -t, --table               Show per-paycheck table for the year (tracks CPP/EI max)
    -a, --annual              Show annualized totals
    -m, --monthly             Show monthly averages
    --headless                Run browser headless (may be blocked by CRA)
    -v, --verbose             Verbose logging (useful for debugging)
    -h, --help                Show this help

  Config file (JSON):
    {
      "province": "Ontario",
      "annualSalary": 100000,
      "payPeriod": "Semi-monthly (24 pay periods a year)",
      "rrspEmployeePercent": 4,
      "rrspEmployerPercent": 4,
      "cppMaxedOut": false,
      "eiMaxedOut": false
    }

  You can pipe a config file via stdin, pass one with --config, or place
  one at ./config.json or ~/.cra-payroll.json. CLI args always win.
  Missing required values will be prompted interactively.
`);
  process.exit(0);
}

// ── Prompt helpers ───────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stderr });

function prompt(question: string): Promise<string> {
  return new Promise((res) => {
    rl.question(question, (answer) => res(answer.trim()));
  });
}

function closePrompt() {
  rl.close();
}

async function promptChoice(label: string, choices: string[], defaultVal?: string): Promise<string> {
  console.error(`\n${label}`);
  choices.forEach((c, i) => console.error(`  ${i + 1}) ${c}`));
  const defHint = defaultVal ? ` [default: ${defaultVal}]` : "";
  const answer = await prompt(`Pick a number${defHint}: `);
  if (!answer && defaultVal) return defaultVal;
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < choices.length) return choices[idx];
  const match = choices.find((c) => c.toLowerCase().startsWith(answer.toLowerCase()));
  if (match) return match;
  if (defaultVal) return defaultVal;
  console.error("Invalid choice, please try again.");
  return promptChoice(label, choices, defaultVal);
}

async function promptNumber(label: string, defaultVal?: number): Promise<number> {
  const defHint = defaultVal !== undefined ? ` [default: ${defaultVal}]` : "";
  const answer = await prompt(`${label}${defHint}: `);
  if (!answer && defaultVal !== undefined) return defaultVal;
  const num = parseFloat(answer);
  if (isNaN(num)) {
    console.error("Please enter a valid number.");
    return promptNumber(label, defaultVal);
  }
  return num;
}

async function promptYesNo(label: string, defaultVal: boolean = false): Promise<boolean> {
  const defHint = defaultVal ? " [Y/n]" : " [y/N]";
  const answer = await prompt(`${label}${defHint}: `);
  if (!answer) return defaultVal;
  return answer.toLowerCase().startsWith("y");
}

// ── Load config: piped stdin → --config → ./config.json → ~/.cra-payroll.json ──

let fileConfig: Partial<PayrollConfig> = {};

// Bun doesn't reliably set process.stdin.isTTY — use fstat to detect piped stdin
let isPiped = false;
try {
  isPiped = fstatSync(0).isFIFO();
} catch {}

if (isPiped) {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (raw) fileConfig = JSON.parse(raw);
  } catch (e: any) {
    console.error(`❌ Could not parse piped stdin as JSON: ${e.message}`);
    process.exit(1);
  }
}

// Fall back to config files if nothing was piped
if (Object.keys(fileConfig).length === 0) {
  const configPaths = [
    values.config ? resolve(values.config) : "",
    resolve("config.json"),
    resolve(process.env.HOME || "~", ".config", "cra-payroll.json"),
    resolve(process.env.HOME || "~", ".cra-payroll.json"),
  ].filter(Boolean);

  for (const p of configPaths) {
    if (p && existsSync(p)) {
      try {
        fileConfig = JSON.parse(readFileSync(p, "utf-8"));
        break;
      } catch (e: any) {
        console.error(`❌ Failed to parse config file ${p}: ${e.message}`);
        process.exit(1);
      }
    }
  }

  // If --config was explicitly passed but file wasn't found, that's an error
  if (values.config && Object.keys(fileConfig).length === 0) {
    console.error(`❌ Config file not found: ${resolve(values.config)}`);
    process.exit(1);
  }
}

// ── Resolve config: CLI args > file config > prompt/default ──

import { ok, err, type Result } from "neverthrow";

async function resolveField<T>(
  label: string,
  cliVal: T | undefined,
  fileVal: T | undefined,
  defaultVal: T | undefined,
  promptFn: (() => Promise<T>) | null
): Promise<Result<T, string>> {
  if (cliVal !== undefined) return ok(cliVal);
  if (fileVal !== undefined) return ok(fileVal);
  if (promptFn && !isPiped) return ok(await promptFn());
  if (defaultVal !== undefined) return ok(defaultVal);
  return err(`${label} is required (pass via config or --${label})`);
}

const provinceResult = await resolveField(
  "province",
  values.province,
  fileConfig.province,
  "Ontario",
  () => promptChoice("Province of employment:", PROVINCES, "Ontario")
);
if (provinceResult.isErr()) { console.error(`❌ ${provinceResult.error}`); process.exit(1); }
const province = provinceResult.value;

const salaryResult = await resolveField(
  "salary",
  values.salary !== undefined ? parseFloat(values.salary) : undefined,
  fileConfig.annualSalary,
  undefined,
  () => promptNumber("Annual salary ($)")
);
if (salaryResult.isErr()) { console.error(`❌ ${salaryResult.error}`); process.exit(1); }
const annualSalary = salaryResult.value;

const payPeriodResult = await resolveField(
  "pay-period",
  values["pay-period"],
  fileConfig.payPeriod,
  "Semi-monthly (24 pay periods a year)",
  () => promptChoice("Pay period:", PAY_PERIODS, "Semi-monthly (24 pay periods a year)")
);
if (payPeriodResult.isErr()) { console.error(`❌ ${payPeriodResult.error}`); process.exit(1); }
const payPeriod = payPeriodResult.value;

const rrspEmployeeResult = await resolveField(
  "rrsp-employee",
  values["rrsp-employee"] !== undefined ? parseFloat(values["rrsp-employee"]) : undefined,
  fileConfig.rrspEmployeePercent,
  4,
  () => promptNumber("Employee RRSP contribution (%)", 4)
);
if (rrspEmployeeResult.isErr()) { console.error(`❌ ${rrspEmployeeResult.error}`); process.exit(1); }
const rrspEmployeePercent = rrspEmployeeResult.value;

const rrspEmployerResult = await resolveField(
  "rrsp-employer",
  values["rrsp-employer"] !== undefined ? parseFloat(values["rrsp-employer"]) : undefined,
  fileConfig.rrspEmployerPercent,
  4,
  () => promptNumber("Employer RRSP match (%)", 4)
);
if (rrspEmployerResult.isErr()) { console.error(`❌ ${rrspEmployerResult.error}`); process.exit(1); }
const rrspEmployerPercent = rrspEmployerResult.value;

// Boolean flags: CLI `false` (default) shouldn't override a config file `true`.
// Only override config if the CLI flag was explicitly passed.
const cppMaxedOut = values["cpp-maxed"] === true ? true : (fileConfig.cppMaxedOut ?? false);
const eiMaxedOut = values["ei-maxed"] === true ? true : (fileConfig.eiMaxedOut ?? false);

closePrompt();

const config: PayrollConfig = {
  province,
  annualSalary,
  payPeriod,
  rrspEmployeePercent,
  rrspEmployerPercent,
  cppMaxedOut,
  eiMaxedOut,
};

// CRA blocks headless browsers — default to headed
const headless = values.headless ?? false;
if (values.verbose) setVerbose(true);

// ── Run ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const wantTable = values.table ?? false;
const wantAnnual = values.annual ?? false;
const wantMonthly = values.monthly ?? false;

console.log("\n🇨🇦 CRA Payroll Deductions Calculator");
console.log("─".repeat(40));
console.log(`Province:          ${config.province}`);
console.log(`Annual Salary:     $${fmt(config.annualSalary)}`);
console.log(`Pay Period:        ${config.payPeriod}`);
console.log(`RRSP (Employee):   ${config.rrspEmployeePercent}%`);
console.log(`RRSP (Employer):   ${config.rrspEmployerPercent}%`);
if (!wantTable && !wantAnnual && !wantMonthly) {
  console.log(`CPP Maxed Out:     ${config.cppMaxedOut ? "Yes" : "No"}`);
  console.log(`EI Maxed Out:      ${config.eiMaxedOut ? "Yes" : "No"}`);
}
console.log("─".repeat(40));
console.log("⏳ Calculating via CRA PDOC...\n");

if (wantTable || wantAnnual || wantMonthly) {
  // Yearly mode: run 2 CRA calculations and build the table
  const yearlyResult = await calculateYearly(config, headless);
  if (yearlyResult.isErr()) {
    console.error(`❌ Error: ${yearlyResult.error}`);
    process.exit(1);
  }
  const { rows, totals } = yearlyResult.value;
  const periodsPerYear = PAY_PERIOD_COUNTS[config.payPeriod];

  if (wantTable) {
    // Header
    console.log("📊 Per-Paycheck Table (2026)");
    console.log("═".repeat(120));
    console.log(
      "  #  │" +
      "     Gross │" +
      "   Fed Tax │" +
      "  Prov Tax │" +
      "       CPP │" +
      "      CPP2 │" +
      "        EI │" +
      "   Net Pay │" +
      " Cum CPP/EI"
    );
    console.log("─".repeat(120));

    for (const r of rows) {
      const cumTotal = r.cumulativeCpp + r.cumulativeCpp2 + r.cumulativeEi;
      const cppEiNote =
        (r.cpp === 0 && r.cpp2 === 0 && r.ei === 0) ? " ✓ maxed" :
        (r.cpp < rows[0].cpp || r.ei < rows[0].ei) ? " ← partial" : "";

      console.log(
        ` ${String(r.period).padStart(2)} │` +
        ` ${fmt(r.grossIncome).padStart(9)} │` +
        ` ${fmt(r.federalTax).padStart(9)} │` +
        ` ${fmt(r.provincialTax).padStart(9)} │` +
        ` ${fmt(r.cpp).padStart(9)} │` +
        ` ${fmt(r.cpp2).padStart(9)} │` +
        ` ${fmt(r.ei).padStart(9)} │` +
        ` ${fmt(r.netPay).padStart(9)} │` +
        ` ${fmt(cumTotal).padStart(9)}${cppEiNote}`
      );
    }

    console.log("─".repeat(120));
    console.log(
      " TOT │" +
      ` ${fmt(totals.grossIncome).padStart(9)} │` +
      ` ${fmt(totals.federalTax).padStart(9)} │` +
      ` ${fmt(totals.provincialTax).padStart(9)} │` +
      ` ${fmt(totals.cpp).padStart(9)} │` +
      ` ${fmt(totals.cpp2).padStart(9)} │` +
      ` ${fmt(totals.ei).padStart(9)} │` +
      ` ${fmt(totals.netPay).padStart(9)} │`
    );
    console.log("═".repeat(120));

    if (totals.rrspEmployee > 0) {
      console.log(`\n  RRSP (Employee): $${fmt(totals.rrspEmployee)}/yr ($${fmt(totals.rrspEmployee / periodsPerYear)}/period)`);
      console.log(`  RRSP (Employer): $${fmt(totals.rrspEmployer)}/yr ($${fmt(totals.rrspEmployer / periodsPerYear)}/period)`);
      console.log(`  💰 Net after RRSP: $${fmt(totals.netPay - totals.rrspEmployee)}/yr`);
    }
  }

  if (wantAnnual) {
    console.log("\n📅 Annual Totals");
    console.log("═".repeat(42));
    console.log(`  Gross Income:       $${fmt(totals.grossIncome).padStart(10)}`);
    if (totals.rrspEmployee > 0)
      console.log(`  RRSP (Employee):   -$${fmt(totals.rrspEmployee).padStart(10)}`);
    if (totals.rrspEmployer > 0)
      console.log(`  RRSP (Employer):   -$${fmt(totals.rrspEmployer).padStart(10)}`);
    console.log("─".repeat(42));
    console.log(`  Federal Tax:       -$${fmt(totals.federalTax).padStart(10)}`);
    console.log(`  Provincial Tax:    -$${fmt(totals.provincialTax).padStart(10)}`);
    console.log(`  CPP:               -$${fmt(totals.cpp).padStart(10)}`);
    if (totals.cpp2 > 0)
      console.log(`  CPP2:              -$${fmt(totals.cpp2).padStart(10)}`);
    console.log(`  EI:                -$${fmt(totals.ei).padStart(10)}`);
    console.log("─".repeat(42));
    console.log(`  Total Deductions:  -$${fmt(totals.totalDeductions).padStart(10)}`);
    console.log("═".repeat(42));
    console.log(`  💰 Net Pay:          $${fmt(totals.netPay).padStart(10)}`);
    if (totals.rrspEmployee > 0)
      console.log(`     (after RRSP):     $${fmt(totals.netPay - totals.rrspEmployee).padStart(10)}`);
  }

  if (wantMonthly) {
    const months = 12;
    console.log("\n📆 Monthly Averages");
    console.log("═".repeat(42));
    console.log(`  Gross Income:       $${fmt(totals.grossIncome / months).padStart(10)}`);
    if (totals.rrspEmployee > 0)
      console.log(`  RRSP (Employee):   -$${fmt(totals.rrspEmployee / months).padStart(10)}`);
    console.log("─".repeat(42));
    console.log(`  Federal Tax:       -$${fmt(totals.federalTax / months).padStart(10)}`);
    console.log(`  Provincial Tax:    -$${fmt(totals.provincialTax / months).padStart(10)}`);
    console.log(`  CPP:               -$${fmt(totals.cpp / months).padStart(10)}`);
    if (totals.cpp2 > 0)
      console.log(`  CPP2:              -$${fmt(totals.cpp2 / months).padStart(10)}`);
    console.log(`  EI:                -$${fmt(totals.ei / months).padStart(10)}`);
    console.log("─".repeat(42));
    console.log(`  Total Deductions:  -$${fmt(totals.totalDeductions / months).padStart(10)}`);
    console.log("═".repeat(42));
    console.log(`  💰 Net Pay:          $${fmt(totals.netPay / months).padStart(10)}`);
    if (totals.rrspEmployee > 0)
      console.log(`     (after RRSP):     $${fmt((totals.netPay - totals.rrspEmployee) / months).padStart(10)}`);
  }
} else {
  // Single period mode
  const calcResult = await calculatePayroll(config, headless);

  if (calcResult.isErr()) {
    console.error(`❌ Error: ${calcResult.error}`);
    process.exit(1);
  }

  const result = calcResult.value;

  console.log("✅ Results (per pay period)");
  console.log("═".repeat(42));
  console.log(`  Gross Income:       $${fmt(result.grossIncome).padStart(10)}`);
  if (result.rrspEmployee > 0)
    console.log(`  RRSP (Employee):   -$${fmt(result.rrspEmployee).padStart(10)}`);
  if (result.rrspEmployer > 0)
    console.log(`  RRSP (Employer):   -$${fmt(result.rrspEmployer).padStart(10)}`);
  console.log("─".repeat(42));
  console.log(`  Federal Tax:       -$${fmt(result.federalTax).padStart(10)}`);
  console.log(`  Provincial Tax:    -$${fmt(result.provincialTax).padStart(10)}`);
  console.log(`  CPP:               -$${fmt(result.cppDeductions).padStart(10)}`);
  if (result.cpp2Deductions > 0)
    console.log(`  CPP2:              -$${fmt(result.cpp2Deductions).padStart(10)}`);
  console.log(`  EI:                -$${fmt(result.eiDeductions).padStart(10)}`);
  console.log("─".repeat(42));
  console.log(`  Total Deductions:  -$${fmt(result.totalDeductions).padStart(10)}`);
  console.log("═".repeat(42));
  console.log(`  💰 Net Pay:          $${fmt(result.netAmount).padStart(10)}`);
  if (result.rrspEmployee > 0)
    console.log(`     (after RRSP):     $${fmt(result.netAmount - result.rrspEmployee).padStart(10)}`);
}
