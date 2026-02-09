#!/usr/bin/env bun
import { parseArgs } from "util";
import { resolve } from "path";
import { existsSync, readFileSync, fstatSync } from "fs";
import { createInterface } from "readline";
import { calculatePayroll, setVerbose, craService, type PayrollConfig } from "./calculator";
import { calculateYearly, PAY_PERIOD_COUNTS } from "./yearly";
import { checkForUpdate, selfUpdate, currentVersion } from "./updater";
import { renderConfig } from "./views/config";
import { renderSingleResult } from "./views/single";
import { renderTable } from "./views/table";
import { renderAnnual, renderMonthly } from "./views/summary";

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
    update: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
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
    --update                  Self-update to the latest release
    --version                 Show current version
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

if (values.version) {
  console.log(`cra-payroll v${currentVersion()}`);
  process.exit(0);
}

if (values.update) {
  const result = await selfUpdate();
  if (result.isErr()) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }
  console.log(result.value);
  process.exit(0);
}

// ── Prompt helpers ───────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stderr });

const prompt = (question: string): Promise<string> =>
  new Promise((res) => {
    rl.question(question, (answer) => res(answer.trim()));
  });

const closePrompt = () => rl.close();

const promptChoice = async (label: string, choices: string[], defaultVal?: string): Promise<string> => {
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
};

const promptNumber = async (label: string, defaultVal?: number): Promise<number> => {
  const defHint = defaultVal !== undefined ? ` [default: ${defaultVal}]` : "";
  const answer = await prompt(`${label}${defHint}: `);
  if (!answer && defaultVal !== undefined) return defaultVal;
  const num = parseFloat(answer);
  if (isNaN(num)) {
    console.error("Please enter a valid number.");
    return promptNumber(label, defaultVal);
  }
  return num;
};

const promptYesNo = async (label: string, defaultVal: boolean = false): Promise<boolean> => {
  const defHint = defaultVal ? " [Y/n]" : " [y/N]";
  const answer = await prompt(`${label}${defHint}: `);
  if (!answer) return defaultVal;
  return answer.toLowerCase().startsWith("y");
};

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

const resolveField = async <T>(
  label: string,
  cliVal: T | undefined,
  fileVal: T | undefined,
  defaultVal: T | undefined,
  promptFn: (() => Promise<T>) | null
): Promise<Result<T, string>> => {
  if (cliVal !== undefined) return ok(cliVal);
  if (fileVal !== undefined) return ok(fileVal);
  if (promptFn && !isPiped) return ok(await promptFn());
  if (defaultVal !== undefined) return ok(defaultVal);
  return err(`${label} is required (pass via config or --${label})`);
};

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

const wantTable = values.table ?? false;
const wantAnnual = values.annual ?? false;
const wantMonthly = values.monthly ?? false;
const showCppEi = !wantTable && !wantAnnual && !wantMonthly;

console.log(renderConfig(config, showCppEi));

if (wantTable || wantAnnual || wantMonthly) {
  const yearlyResult = await calculateYearly(craService, config, headless);
  if (yearlyResult.isErr()) {
    console.error(`Error: ${yearlyResult.error}`);
    process.exit(1);
  }

  const yearly = yearlyResult.value;
  const periodsPerYear = PAY_PERIOD_COUNTS[config.payPeriod];

  if (wantTable) console.log(renderTable(yearly, periodsPerYear));
  if (wantAnnual) console.log(renderAnnual(yearly.totals));
  if (wantMonthly) console.log(renderMonthly(yearly.totals));
} else {
  const calcResult = await calculatePayroll(config, headless);
  if (calcResult.isErr()) {
    console.error(`Error: ${calcResult.error}`);
    process.exit(1);
  }

  console.log(renderSingleResult(calcResult.value));
}

// ── Background update check ─────────────────────────────────
const updateInfo = await checkForUpdate();
if (updateInfo.isOk() && updateInfo.value) {
  console.log(`\nUpdate available: ${updateInfo.value.tag} (current: v${currentVersion()})`);
  console.log(`Run 'cra-payroll --update' to install it.`);
}
