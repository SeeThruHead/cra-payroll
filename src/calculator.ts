import { chromium, type Page, type Browser } from "playwright";
import { ok, err, Result, ResultAsync, fromPromise } from "neverthrow";

export interface PayrollConfig {
  province: string;
  annualSalary: number;
  payPeriod: string;
  rrspEmployeePercent: number;
  rrspEmployerPercent: number;
  cppMaxedOut: boolean;
  eiMaxedOut: boolean;
}

export interface PayrollResult {
  grossIncome: number;
  rrspEmployee: number;
  rrspEmployer: number;
  federalTax: number;
  provincialTax: number;
  cppDeductions: number;
  cpp2Deductions: number;
  eiDeductions: number;
  totalDeductions: number;
  netAmount: number;
}

const PAY_PERIODS: Record<string, number> = {
  "Daily (240 pay periods a year)": 240,
  "Weekly (52 pay periods a year)": 52,
  "Biweekly (26 pay periods a year)": 26,
  "Semi-monthly (24 pay periods a year)": 24,
  "Monthly (12 pay periods a year)": 12,
  "(10 pay periods a year)": 10,
  "(13 pay periods a year)": 13,
  "(22 pay periods a year)": 22,
  "Weekly (53 pay periods a year)": 53,
  "Biweekly (27 pay periods a year)": 27,
};

const LAUNCH_TIMEOUT = 3_000;
const PAGE_TIMEOUT = 3_000;
const ACTION_TIMEOUT = 3_000;

let verbose = false;
export function setVerbose(v: boolean) {
  verbose = v;
}
function log(msg: string) {
  if (verbose) console.error(`  [cra] ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Result helpers ──────────────────────────────────────────

function safe<T>(p: Promise<T>, label: string): ResultAsync<T, string> {
  return fromPromise(p, (e: any) => `${label}: ${e.message ?? e}`);
}

async function retry<T>(
  fn: () => ResultAsync<T, string>,
  attempts: number,
  delayMs: number,
  label: string
): Promise<Result<T, string>> {
  for (let i = 1; i <= attempts; i++) {
    log(`${label} (attempt ${i})...`);
    const result = await fn();
    if (result.isOk()) return result;
    log(`${label} attempt ${i} failed: ${result.error}`);
    if (i < attempts) await sleep(delayMs);
  }
  return err(`${label} failed after ${attempts} attempts`);
}

/** Run a sequence of steps, short-circuiting on the first error and running cleanup */
async function pipeline(
  cleanup: () => Promise<void>,
  ...steps: (() => Promise<Result<unknown, string>>)[]
): Promise<Result<void, string>> {
  for (const step of steps) {
    const result = await step();
    if (result.isErr()) {
      await cleanup();
      return err(result.error);
    }
  }
  return ok(undefined);
}

// ── Browser / page helpers ──────────────────────────────────

function launchBrowser(headless: boolean): ResultAsync<Browser, string> {
  let timer: ReturnType<typeof setTimeout>;
  let launched = false;

  return ResultAsync.fromSafePromise<Browser | "__timeout__", never>(
    Promise.race([
      chromium.launch({ headless }).then((b) => { launched = true; clearTimeout(timer); return b; }),
      new Promise<"__timeout__">((resolve) => {
        timer = setTimeout(() => resolve("__timeout__"), LAUNCH_TIMEOUT);
      }),
    ])
  ).andThen((result) => {
    if (result === "__timeout__") {
      // If launch resolves later, we can't close it — but at least we're not waiting
      return err(`Browser launch timed out (${LAUNCH_TIMEOUT / 1000}s)`);
    }
    return ok(result as Browser);
  });
}

async function closeBrowser(browser: Browser): Promise<Result<void, string>> {
  return safe(browser.close(), "browser close");
}

/** Wait for the CRA loading splash ("Loading/Chargement...") to disappear.
 *  Uses a single locator matching either text. If neither is present, that's fine — means it already loaded. */
async function waitForLoading(page: Page): Promise<Result<void, string>> {
  const result = await safe(
    page.locator("text=/Loading|Chargement/").waitFor({ state: "hidden", timeout: PAGE_TIMEOUT }),
    "wait for loading splash"
  );
  // If the locator wasn't found at all, that means the splash was never shown — not an error
  if (result.isErr() && result.error.includes("waiting for locator")) {
    log("no loading splash detected, continuing");
    return ok(undefined);
  }
  return result.map(() => undefined);
}

async function waitForStep(page: Page, urlSubstring: string): Promise<Result<void, string>> {
  log(`waiting for /${urlSubstring}...`);

  const nav = await safe(
    page.waitForURL(`**/${urlSubstring}`, { timeout: PAGE_TIMEOUT }),
    `navigate to ${urlSubstring}`
  );
  if (nav.isErr()) return nav.map(() => undefined);

  const loading = await waitForLoading(page);
  if (loading.isErr()) return loading;

  const heading = await safe(
    page.locator("main h1").waitFor({ state: "visible", timeout: ACTION_TIMEOUT }),
    `${urlSubstring} heading visible`
  );
  if (heading.isErr()) return heading.map(() => undefined);

  log(`on /${urlSubstring}`);
  return ok(undefined);
}

async function selectLatestYear(page: Page): Promise<Result<void, string>> {
  const yearSelect = page.locator("#datePaidYear");
  const optionsResult = await safe(
    yearSelect.locator("option").allTextContents(),
    "read year options"
  );
  if (optionsResult.isErr()) return err(optionsResult.error);

  const years = optionsResult.value
    .map((t) => parseInt(t, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => b - a);

  if (years.length === 0) return err("No valid years in date dropdown");

  return safe(yearSelect.selectOption(years[0].toString()), "select year").map(() => undefined);
}

// ── Main calculator ─────────────────────────────────────────

export async function calculatePayroll(
  config: PayrollConfig,
  headless: boolean = false
): Promise<Result<PayrollResult, string>> {
  const periodsPerYear = PAY_PERIODS[config.payPeriod];
  if (!periodsPerYear) {
    return err(`Unknown pay period: "${config.payPeriod}"`);
  }

  const salaryPerPeriod = (config.annualSalary / periodsPerYear).toFixed(2);
  const rrspEmployeePerPeriod = (
    (config.annualSalary * (config.rrspEmployeePercent / 100)) / periodsPerYear
  ).toFixed(2);
  const rrspEmployerPerPeriod = (
    (config.annualSalary * (config.rrspEmployerPercent / 100)) / periodsPerYear
  ).toFixed(2);

  // Launch browser with retries
  const browserResult = await retry(() => launchBrowser(headless), 3, 1000, "browser launch");
  if (browserResult.isErr()) return err(browserResult.error);

  const browser = browserResult.value;
  log("browser launched");

  const contextResult = await safe(browser.newContext(), "create context");
  if (contextResult.isErr()) { await closeBrowser(browser); return err(contextResult.error); }

  const pageResult = await safe(contextResult.value.newPage(), "create page");
  if (pageResult.isErr()) { await closeBrowser(browser); return err(pageResult.error); }

  const page = pageResult.value;
  page.setDefaultTimeout(ACTION_TIMEOUT);

  const cleanup = () => closeBrowser(browser).then(() => {});

  // ── Entry page with retries ──
  const entryResult = await retry(
    () => safe(
      (async () => {
        await page.goto("https://apps.cra-arc.gc.ca/ebci/rhpd/beta/entry", {
          timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded",
        });
        const loadResult = await waitForLoading(page);
        if (loadResult.isErr()) throw new Error(loadResult.error);
        await page.getByRole("button", { name: "Next" }).waitFor({
          state: "visible", timeout: PAGE_TIMEOUT,
        });
      })(),
      "load entry page"
    ),
    3, 1000, "entry page"
  );
  if (entryResult.isErr()) { await cleanup(); return err(entryResult.error); }
  log("entry page loaded");

  // ── Walk through the wizard ──
  const wizardResult = await pipeline(
    cleanup,
    // Click Next on entry page
    () => safe(page.getByRole("button", { name: "Next" }).click(), "click Next entry").then(r => r.map(() => undefined)),
    () => waitForStep(page, "step1"),

    // Step 1 — Employee info
    async () => {
      log("filling step 1...");
      const province = await safe(page.getByLabel("Province or territory of").selectOption(config.province), "select province");
      if (province.isErr()) return province.map(() => undefined);

      const payPeriod = await safe(page.getByLabel("Pay period frequency (").selectOption(config.payPeriod), "select pay period");
      if (payPeriod.isErr()) return payPeriod.map(() => undefined);

      const year = await selectLatestYear(page);
      if (year.isErr()) return year;

      const month = await safe(
        page.locator('select[title="Select the month the employee is paid."]').selectOption("January"),
        "select month"
      );
      if (month.isErr()) return month.map(() => undefined);

      const day = await safe(
        page.locator('select[title="Select the day the employee is paid."]').selectOption("15"),
        "select day"
      );
      if (day.isErr()) return day.map(() => undefined);

      return safe(page.getByRole("button", { name: "Next" }).click(), "click Next step 1").then(r => r.map(() => undefined));
    },
    () => waitForStep(page, "step2"),

    // Step 2 — Salary info
    async () => {
      log("filling step 2...");
      const salary = await safe(
        page.getByRole("textbox", { name: /Salary or wages income per/ }).fill(salaryPerPeriod),
        "fill salary"
      );
      if (salary.isErr()) return salary.map(() => undefined);

      if (config.rrspEmployerPercent > 0) {
        log("checking employer RRSP...");
        const check = await safe(
          page.getByRole("checkbox", { name: /Employer's contributions to the employee's RRSP/ }).check(),
          "check employer RRSP"
        );
        if (check.isErr()) return check.map(() => undefined);

        const field = page.getByRole("textbox", { name: /Employer's contributions to the employee's RRSP/ });
        const visible = await safe(field.waitFor({ state: "visible" }), "employer RRSP field visible");
        if (visible.isErr()) return visible.map(() => undefined);

        const fill = await safe(field.fill(rrspEmployerPerPeriod), "fill employer RRSP");
        if (fill.isErr()) return fill.map(() => undefined);
      }

      if (config.rrspEmployeePercent > 0) {
        log("checking employee RRSP...");
        const check = await safe(
          page.getByRole("checkbox", { name: /Employee's contributions to RRSPs or RPPs/ }).check(),
          "check employee RRSP"
        );
        if (check.isErr()) return check.map(() => undefined);

        const field = page.getByRole("textbox", { name: /Employee's contributions to a RRSP \(deduct at source\)/ });
        const visible = await safe(field.waitFor({ state: "visible" }), "employee RRSP field visible");
        if (visible.isErr()) return visible.map(() => undefined);

        const fill = await safe(field.fill(rrspEmployeePerPeriod), "fill employee RRSP");
        if (fill.isErr()) return fill.map(() => undefined);
      }

      return safe(page.getByRole("button", { name: "Next" }).click(), "click Next step 2").then(r => r.map(() => undefined));
    },
    () => waitForStep(page, "step3"),

    // Step 3 — CPP / EI
    async () => {
      log("filling step 3...");
      if (config.cppMaxedOut) {
        const cpp = await safe(page.getByRole("radio", { name: /CPP and second additional CPP/ }).click(), "select CPP maxed");
        if (cpp.isErr()) return cpp.map(() => undefined);
      }
      if (config.eiMaxedOut) {
        const ei = await safe(page.getByRole("radio", { name: /EI maximum annual premium has/ }).click(), "select EI maxed");
        if (ei.isErr()) return ei.map(() => undefined);
      }
      return safe(page.getByRole("button", { name: "Calculate" }).click(), "click Calculate").then(r => r.map(() => undefined));
    },
    () => waitForStep(page, "results"),
  );

  if (wizardResult.isErr()) return err(wizardResult.error);

  // ── Results ──
  log("waiting for results...");
  const resultsReady = await retry(
    () => safe(
      page.locator("text=Net amount").waitFor({ state: "visible", timeout: PAGE_TIMEOUT }),
      "results render"
    ),
    2, 0, "results render"
  );

  if (resultsReady.isErr()) {
    const bodyResult = await safe(page.locator("body").innerText(), "read body on failure");
    const bodyText = bodyResult.isOk() ? bodyResult.value.slice(0, 500) : "(could not read page)";
    log("page content on failure:\n" + bodyText);
    await cleanup();
    return err(`Results page did not render — 'Net amount' not found. Page: ${bodyText.slice(0, 100)}`);
  }

  const textResult = await safe(page.locator("main").innerText(), "read results text");
  if (textResult.isErr()) { await cleanup(); return err(textResult.error); }

  log("got results, parsing...");
  const parsed = parseResults(textResult.value, config, periodsPerYear);

  log("closing browser");
  const closeResult = await closeBrowser(browser);
  if (closeResult.isErr()) log(`warning: ${closeResult.error}`);

  return parsed;
}

// ── Parse results ───────────────────────────────────────────

function parseResults(
  text: string,
  config: PayrollConfig,
  periodsPerYear: number
): Result<PayrollResult, string> {
  const missing: string[] = [];
  const extract = (pattern: RegExp, label: string): number => {
    const match = text.match(pattern);
    if (!match) { missing.push(label); return 0; }
    return parseFloat(match[1].replace(/,/g, ""));
  };

  const grossIncome = extract(/Salary or wages income\s+([\d,]+\.\d{2})/, "gross income");
  const federalTax = extract(/Federal tax deduction\s+([\d,]+\.\d{2})/, "federal tax");
  const provincialTax = extract(/Provincial tax deduction\s+([\d,]+\.\d{2})/, "provincial tax");
  const cppDeductions = extract(/CPP deductions\s+([\d,]+\.\d{2})/, "CPP deductions");
  const cpp2Deductions = extract(/CPP2 deductions\s+([\d,]+\.\d{2})/, "CPP2 deductions");
  const eiDeductions = extract(/EI deductions\s+([\d,]+\.\d{2})/, "EI deductions");
  const totalDeductions = extract(/Total deductions\s+([\d,]+\.\d{2})/, "total deductions");
  const netAmount = extract(/Net amount\s+([\d,]+\.\d{2})/, "net amount");

  if (grossIncome === 0 && config.annualSalary > 0) {
    return err(`Parsed $0 gross income — CRA page format may have changed. Missing fields: ${missing.join(", ")}`);
  }

  if (missing.length > 0) {
    log(`warning: could not parse fields: ${missing.join(", ")}`);
  }

  const rrspEmployeePerPeriod = (config.annualSalary * (config.rrspEmployeePercent / 100)) / periodsPerYear;
  const rrspEmployerPerPeriod = (config.annualSalary * (config.rrspEmployerPercent / 100)) / periodsPerYear;

  return ok({
    grossIncome,
    rrspEmployee: Math.round(rrspEmployeePerPeriod * 100) / 100,
    rrspEmployer: Math.round(rrspEmployerPerPeriod * 100) / 100,
    federalTax,
    provincialTax,
    cppDeductions,
    cpp2Deductions,
    eiDeductions,
    totalDeductions,
    netAmount,
  });
}
