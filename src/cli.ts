#!/usr/bin/env node
import { parseArgs } from "util";
import { resolve } from "path";
import { existsSync, readFileSync, fstatSync } from "fs";
import { createInterface } from "readline";
import { ok, err, type Result } from "neverthrow";
import { setVerbose, craService, craServiceNoCache, type PayrollConfig } from "./calculator";
import { calculateYearly, PAY_PERIOD_COUNTS } from "./yearly";
import { checkForUpdate, selfUpdate, currentVersion } from "./updater";
import { renderConfig } from "./views/config";
import { renderSingleResult } from "./views/single";
import { renderTable } from "./views/table";
import { renderMonthlyTable } from "./views/monthlyTable";
import { groupByMonth } from "./monthly";
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
    year: { type: "string", short: "y" },
    "rrsp-match": { type: "string" },
    "rrsp-unmatched": { type: "string" },
    "cpp-maxed": { type: "boolean", default: false },
    "ei-maxed": { type: "boolean", default: false },
    table: { type: "boolean", short: "t", default: false },
    "month-table": { type: "boolean", short: "M", default: false },
    annual: { type: "boolean", short: "a", default: false },
    monthly: { type: "boolean", short: "m", default: false },
    "no-cache": { type: "boolean", default: false },
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
    -y, --year <year>         Tax year (default: current year)
    --pay-period <type>       Pay period (e.g. "Semi-monthly (24 pay periods a year)")
    --rrsp-match <pct>        RRSP match % (employee + employer both contribute this, default: 4)
    --rrsp-unmatched <pct>    Additional unmatched employee RRSP % (default: 0)
    --cpp-maxed               CPP contributions maxed out for the year
    --ei-maxed                EI premiums maxed out for the year
    -t, --table               Show per-paycheck table for the year (tracks CPP/EI max)
    -M, --month-table         Show monthly table for the year
    -a, --annual              Show annualized totals
    -m, --monthly             Show monthly averages
    --no-cache                Skip cache and force a fresh CRA lookup
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
      "year": 2026,
      "rrspMatchPercent": 4,
      "rrspUnmatchedPercent": 0,
      "cppMaxedOut": false,
      "eiMaxedOut": false
    }

  You can pipe a config file via stdin, pass one with --config, or place
  one at ./config.json or ~/.cra-payroll.json. CLI args always win.
  Missing required values will be prompted interactively.
`);
  process.exit(0);
}

const isCompiledBinary = !process.execPath.endsWith("node") && !process.execPath.endsWith("bun");

if (values.version) {
  console.log(`cra-payroll v${currentVersion()}`);
  process.exit(0);
}

if (values.update) {
  if (!isCompiledBinary) {
    console.log("Self-update is only available for the standalone binary. Use `npm update -g cra-payroll` instead.");
    process.exit(0);
  }
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

// ── Config loading ───────────────────────────────────────────

const detectPipedStdin = (): boolean => {
  try { return fstatSync(0).isFIFO(); } catch { return false; }
};

const readStdinConfig = async (): Promise<Partial<PayrollConfig>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
};

const readFileConfig = (configFlag: string): Partial<PayrollConfig> => {
  const configPaths = [
    configFlag ? resolve(configFlag) : "",
    resolve("config.json"),
    resolve(process.env.HOME || "~", ".config", "cra-payroll.json"),
    resolve(process.env.HOME || "~", ".cra-payroll.json"),
  ].filter(Boolean);

  for (const p of configPaths) {
    if (p && existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf-8"));
    }
  }

  return {};
};

const loadFileConfig = async (configFlag: string, isPiped: boolean): Promise<Result<Partial<PayrollConfig>, string>> => {
  if (isPiped) {
    try {
      return ok(await readStdinConfig());
    } catch (e: any) {
      return err(`Could not parse piped stdin as JSON: ${e.message}`);
    }
  }

  try {
    const config = readFileConfig(configFlag);
    if (configFlag && Object.keys(config).length === 0) {
      return err(`Config file not found: ${resolve(configFlag)}`);
    }
    return ok(config);
  } catch (e: any) {
    return err(`Failed to parse config file: ${e.message}`);
  }
};

// ── Config resolution ────────────────────────────────────────

const resolveField = async <T>(
  label: string,
  cliVal: T | undefined,
  fileVal: T | undefined,
  defaultVal: T | undefined,
  promptFn: (() => Promise<T>) | null,
  isPiped: boolean,
): Promise<Result<T, string>> => {
  if (cliVal !== undefined) return ok(cliVal);
  if (fileVal !== undefined) return ok(fileVal);
  if (promptFn && !isPiped) return ok(await promptFn());
  if (defaultVal !== undefined) return ok(defaultVal);
  return err(`${label} is required (pass via config or --${label})`);
};

const resolveConfig = async (
  vals: typeof values,
  fileConfig: Partial<PayrollConfig>,
  isPiped: boolean,
): Promise<Result<PayrollConfig, string>> => {
  const province = await resolveField(
    "province", vals.province, fileConfig.province, "Ontario",
    () => promptChoice("Province of employment:", PROVINCES, "Ontario"), isPiped,
  );
  if (province.isErr()) return err(province.error);

  const year = await resolveField(
    "year",
    vals.year !== undefined ? parseInt(vals.year, 10) : undefined,
    fileConfig.year, new Date().getFullYear(),
    () => promptNumber("Tax year", new Date().getFullYear()), isPiped,
  );
  if (year.isErr()) return err(year.error);

  const salary = await resolveField(
    "salary",
    vals.salary !== undefined ? parseFloat(vals.salary) : undefined,
    fileConfig.annualSalary, undefined,
    () => promptNumber("Annual salary ($)"), isPiped,
  );
  if (salary.isErr()) return err(salary.error);

  const payPeriod = await resolveField(
    "pay-period", vals["pay-period"], fileConfig.payPeriod,
    "Semi-monthly (24 pay periods a year)",
    () => promptChoice("Pay period:", PAY_PERIODS, "Semi-monthly (24 pay periods a year)"), isPiped,
  );
  if (payPeriod.isErr()) return err(payPeriod.error);

  const rrspMatch = await resolveField(
    "rrsp-match",
    vals["rrsp-match"] !== undefined ? parseFloat(vals["rrsp-match"]) : undefined,
    fileConfig.rrspMatchPercent, 4,
    () => promptNumber("RRSP match % (employee + employer both contribute)", 4), isPiped,
  );
  if (rrspMatch.isErr()) return err(rrspMatch.error);

  const rrspUnmatched = await resolveField(
    "rrsp-unmatched",
    vals["rrsp-unmatched"] !== undefined ? parseFloat(vals["rrsp-unmatched"]) : undefined,
    fileConfig.rrspUnmatchedPercent, 0,
    () => promptNumber("Additional unmatched employee RRSP %", 0), isPiped,
  );
  if (rrspUnmatched.isErr()) return err(rrspUnmatched.error);

  const cppMaxedOut = vals["cpp-maxed"] === true ? true : (fileConfig.cppMaxedOut ?? false);
  const eiMaxedOut = vals["ei-maxed"] === true ? true : (fileConfig.eiMaxedOut ?? false);

  return ok({
    province: province.value,
    annualSalary: salary.value,
    payPeriod: payPeriod.value,
    year: year.value,
    rrspMatchPercent: rrspMatch.value,
    rrspUnmatchedPercent: rrspUnmatched.value,
    cppMaxedOut,
    eiMaxedOut,
  });
};

// ── Run ──────────────────────────────────────────────────────

const runYearlyMode = async (config: PayrollConfig, headless: boolean, svc: typeof craService, flags: { table: boolean; monthTable: boolean; annual: boolean; monthly: boolean }) => {
  const yearlyResult = await calculateYearly(svc, config, headless);
  if (yearlyResult.isErr()) {
    console.error(`Error: ${yearlyResult.error}`);
    process.exit(1);
  }

  const yearly = yearlyResult.value;
  const periodsPerYear = PAY_PERIOD_COUNTS[config.payPeriod];

  if (flags.table) console.log(renderTable(yearly, periodsPerYear, config.year));
  if (flags.monthTable) {
    const monthly = groupByMonth(yearly, config.year, config.payPeriod, periodsPerYear);
    console.log(renderMonthlyTable(monthly, config.year));
  }
  if (flags.annual) console.log(renderAnnual(yearly.totals));
  if (flags.monthly) console.log(renderMonthly(yearly.totals));
};

const runSingleMode = async (config: PayrollConfig, headless: boolean, svc: typeof craService) => {
  const calcResult = await svc.calculate(config, headless);
  if (calcResult.isErr()) {
    console.error(`Error: ${calcResult.error}`);
    process.exit(1);
  }

  console.log(renderSingleResult(calcResult.value));
};

const showUpdateNag = async () => {
  if (!isCompiledBinary) return;
  const updateInfo = await checkForUpdate();
  if (updateInfo.isOk() && updateInfo.value) {
    console.log(`\nUpdate available: ${updateInfo.value.tag} (current: v${currentVersion()})`);
    console.log(`Run 'cra-payroll --update' to install it.`);
  }
};

// ── Main ─────────────────────────────────────────────────────

const isPiped = detectPipedStdin();

const fileConfigResult = await loadFileConfig(values.config ?? "", isPiped);
if (fileConfigResult.isErr()) {
  console.error(`❌ ${fileConfigResult.error}`);
  process.exit(1);
}

const configResult = await resolveConfig(values, fileConfigResult.value, isPiped);
rl.close();

if (configResult.isErr()) {
  console.error(`❌ ${configResult.error}`);
  process.exit(1);
}

const config = configResult.value;
const headless = values.headless ?? false;
const service = values["no-cache"] ? craServiceNoCache : craService;
if (values.verbose) setVerbose(true);

const wantTable = values.table ?? false;
const wantMonthTable = values["month-table"] ?? false;
const wantAnnual = values.annual ?? false;
const wantMonthly = values.monthly ?? false;

console.log(renderConfig(config, !wantTable && !wantMonthTable && !wantAnnual && !wantMonthly));

if (wantTable || wantMonthTable || wantAnnual || wantMonthly) {
  await runYearlyMode(config, headless, service, { table: wantTable, monthTable: wantMonthTable, annual: wantAnnual, monthly: wantMonthly });
} else {
  await runSingleMode(config, headless, service);
}

await showUpdateNag();
