import puppeteer, { type Page, type Browser } from "puppeteer-core";
import { ok, err, Result, ResultAsync } from "neverthrow";

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

const LAUNCH_TIMEOUT = 5_000;
const PAGE_TIMEOUT = 5_000;
const ACTION_TIMEOUT = 3_000;

let verbose = false;
export function setVerbose(v: boolean) {
  verbose = v;
}
function log(msg: string) {
  if (verbose) console.error(`  [cra] ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Find Chrome ─────────────────────────────────────────────

function findChrome(): Result<string, string> {
  const paths: Record<string, string[]> = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ],
  };

  const candidates = paths[process.platform] ?? [];
  for (const p of candidates) {
    try {
      const { statSync } = require("fs");
      statSync(p);
      return ok(p);
    } catch {}
  }

  return err(
    `Chrome not found. Install Google Chrome from https://www.google.com/chrome/\n` +
    `Searched: ${candidates.join(", ")}`
  );
}

// ── Result helpers ──────────────────────────────────────────

function safe<T>(p: Promise<T>, label: string): ResultAsync<T, string> {
  return ResultAsync.fromPromise(p, (e: any) => `${label}: ${e.message ?? e}`);
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

// ── Puppeteer helpers ───────────────────────────────────────

async function selectOption(page: Page, selector: string, value: string): Promise<Result<void, string>> {
  return safe(page.select(selector, value).then(() => {}), `select ${selector}`);
}

async function waitForNav(page: Page, urlPart: string): Promise<Result<void, string>> {
  log(`waiting for /${urlPart}...`);
  const result = await safe(
    page.waitForFunction(
      (part: string) => window.location.href.includes(part),
      { timeout: PAGE_TIMEOUT },
      urlPart
    ),
    `navigate to ${urlPart}`
  );
  if (result.isErr()) return err(result.error);

  // Wait for loading splash to disappear
  await safe(
    page.waitForFunction(
      () => {
        const body = document.body?.innerText ?? "";
        return !body.includes("Loading") || body.length > 200;
      },
      { timeout: PAGE_TIMEOUT }
    ),
    "wait for loading"
  ).unwrapOr(undefined);

  // Wait for main heading
  await safe(
    page.waitForSelector("main h1", { visible: true, timeout: ACTION_TIMEOUT }),
    `${urlPart} heading`
  ).unwrapOr(undefined);

  log(`on /${urlPart}`);
  return ok(undefined);
}

async function click(page: Page, selector: string, label: string): Promise<Result<void, string>> {
  const el = await safe(page.waitForSelector(selector, { visible: true, timeout: ACTION_TIMEOUT }), `find ${label}`);
  if (el.isErr()) return err(el.error);
  return safe(el.value!.click(), `click ${label}`);
}

async function type(page: Page, selector: string, value: string, label: string): Promise<Result<void, string>> {
  const el = await safe(page.waitForSelector(selector, { visible: true, timeout: ACTION_TIMEOUT }), `find ${label}`);
  if (el.isErr()) return err(el.error);
  // Clear and type
  await el.value!.click({ clickCount: 3 });
  return safe(el.value!.type(value), `type ${label}`);
}

async function checkBox(page: Page, selector: string, label: string): Promise<Result<void, string>> {
  const el = await safe(page.waitForSelector(selector, { visible: true, timeout: ACTION_TIMEOUT }), `find ${label}`);
  if (el.isErr()) return err(el.error);
  const checked = await el.value!.evaluate((e: any) => e.checked);
  if (!checked) return safe(el.value!.click(), `check ${label}`);
  return ok(undefined);
}

async function clickRadio(page: Page, namePattern: string, label: string): Promise<Result<void, string>> {
  // Find radio by name attribute pattern
  const result = await safe(
    page.$$eval("input[type='radio']", (radios, pattern) => {
      const r = radios.find((el: any) => el.name && new RegExp(pattern, "i").test(el.labels?.[0]?.textContent ?? el.name));
      if (r) { (r as HTMLInputElement).click(); return true; }
      return false;
    }, namePattern),
    `find radio ${label}`
  );
  if (result.isErr()) return err(result.error);
  if (!result.value) return err(`Radio not found: ${label}`);
  return ok(undefined);
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

  // Find Chrome
  const chromePath = findChrome();
  if (chromePath.isErr()) return err(chromePath.error);
  log(`using Chrome: ${chromePath.value}`);

  // Launch browser with retries
  const browserResult = await retry(
    () => ResultAsync.fromPromise(
      Promise.race([
        puppeteer.launch({
          headless,
          executablePath: chromePath.value,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Browser launch timed out (${LAUNCH_TIMEOUT / 1000}s)`)), LAUNCH_TIMEOUT)
        ),
      ]),
      (e: any) => e.message ?? String(e)
    ),
    3, 1000, "browser launch"
  );
  if (browserResult.isErr()) return err(browserResult.error);

  const browser = browserResult.value;
  log("browser launched");

  const cleanup = async () => { await browser.close().catch(() => {}); };

  const pageResult = await safe(browser.newPage(), "create page");
  if (pageResult.isErr()) { await cleanup(); return err(pageResult.error); }
  const page = pageResult.value;
  page.setDefaultTimeout(ACTION_TIMEOUT);

  // ── Entry page with retries ──
  const entryResult = await retry(
    () => ResultAsync.fromPromise(
      (async () => {
        await page.goto("https://apps.cra-arc.gc.ca/ebci/rhpd/beta/entry", {
          timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded",
        });
        await page.waitForSelector("button", { visible: true, timeout: PAGE_TIMEOUT });
      })(),
      (e: any) => `load entry page: ${e.message ?? e}`
    ),
    3, 1000, "entry page"
  );
  if (entryResult.isErr()) { await cleanup(); return err(entryResult.error); }
  log("entry page loaded");

  // Click Next on entry
  const nextEntry = await click(page, 'button[type="submit"], button.btn-primary', "Next button");
  if (nextEntry.isErr()) { await cleanup(); return err(nextEntry.error); }

  const step1 = await waitForNav(page, "step1");
  if (step1.isErr()) { await cleanup(); return err(step1.error); }

  // ── Step 1 — Employee info ──
  log("filling step 1...");

  // Province
  const provinceSelect = await safe(
    page.$$eval("select", (selects, prov) => {
      const s = selects.find((el: any) => el.labels?.[0]?.textContent?.includes("Province"));
      if (s) { (s as HTMLSelectElement).value = ""; return s.id; }
      return null;
    }, config.province),
    "find province select"
  );
  // Use the select by evaluating options
  const provResult = await safe(
    page.$$eval("select", (selects, prov) => {
      for (const s of selects) {
        const label = (s as any).labels?.[0]?.textContent ?? "";
        if (label.includes("Province") || label.includes("province")) {
          const opts = Array.from((s as HTMLSelectElement).options);
          const match = opts.find(o => o.text.includes(prov));
          if (match) {
            (s as HTMLSelectElement).value = match.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    }, config.province),
    "select province"
  );
  if (provResult.isErr()) { await cleanup(); return err(provResult.error); }

  // Pay period
  const ppResult = await safe(
    page.$$eval("select", (selects, pp) => {
      for (const s of selects) {
        const label = (s as any).labels?.[0]?.textContent ?? "";
        if (label.includes("Pay period") || label.includes("pay period")) {
          const opts = Array.from((s as HTMLSelectElement).options);
          const match = opts.find(o => o.text.includes(pp));
          if (match) {
            (s as HTMLSelectElement).value = match.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    }, config.payPeriod),
    "select pay period"
  );
  if (ppResult.isErr()) { await cleanup(); return err(ppResult.error); }

  // Year — select the latest
  const yearResult = await safe(
    page.$$eval("select", (selects) => {
      const s = selects.find((el: any) => el.id === "datePaidYear" || el.title?.includes("year"));
      if (!s) return false;
      const opts = Array.from((s as HTMLSelectElement).options)
        .map(o => parseInt(o.value))
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a);
      if (opts.length === 0) return false;
      (s as HTMLSelectElement).value = opts[0].toString();
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }),
    "select year"
  );
  if (yearResult.isErr()) { await cleanup(); return err(yearResult.error); }

  // Month
  const monthResult = await safe(
    page.$eval('select[title*="month" i], #datePaidMonth', (s: any) => {
      const opts = Array.from((s as HTMLSelectElement).options);
      const jan = opts.find((o: any) => o.text.includes("January") || o.value === "1" || o.value === "01");
      if (jan) {
        s.value = jan.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }),
    "select month"
  );
  if (monthResult.isErr()) log(`month select warning: ${monthResult.error}`);

  // Day
  const dayResult = await safe(
    page.$eval('select[title*="day" i], #datePaidDay', (s: any) => {
      const opts = Array.from((s as HTMLSelectElement).options);
      const d15 = opts.find((o: any) => o.value === "15");
      if (d15) {
        s.value = d15.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }),
    "select day"
  );
  if (dayResult.isErr()) log(`day select warning: ${dayResult.error}`);

  // Click Next
  const nextStep1 = await click(page, 'button[type="submit"], button.btn-primary', "Next step 1");
  if (nextStep1.isErr()) { await cleanup(); return err(nextStep1.error); }

  const step2 = await waitForNav(page, "step2");
  if (step2.isErr()) { await cleanup(); return err(step2.error); }

  // ── Step 2 — Salary info ──
  log("filling step 2...");

  // Find salary input and fill it
  const salaryResult = await safe(
    page.$$eval("input[type='text'], input[type='number']", (inputs, salary) => {
      for (const inp of inputs) {
        const label = (inp as any).labels?.[0]?.textContent ?? "";
        const name = (inp as HTMLInputElement).name ?? "";
        if (label.includes("Salary or wages") || name.includes("Salary") || name.includes("salary")) {
          const el = inp as HTMLInputElement;
          el.value = salary;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, salaryPerPeriod),
    "fill salary"
  );
  if (salaryResult.isErr()) { await cleanup(); return err(salaryResult.error); }

  // Employer RRSP
  if (config.rrspEmployerPercent > 0) {
    log("checking employer RRSP...");
    const checkResult = await safe(
      page.$$eval("input[type='checkbox']", (boxes) => {
        const cb = boxes.find((b: any) => {
          const label = b.labels?.[0]?.textContent ?? b.name ?? "";
          return label.includes("Employer") && label.includes("RRSP");
        });
        if (cb && !(cb as HTMLInputElement).checked) (cb as HTMLInputElement).click();
        return !!cb;
      }),
      "check employer RRSP"
    );
    if (checkResult.isErr()) { await cleanup(); return err(checkResult.error); }

    await sleep(500); // Wait for field to appear

    const fillResult = await safe(
      page.$$eval("input[type='text'], input[type='number']", (inputs, val) => {
        for (const inp of inputs) {
          const label = (inp as any).labels?.[0]?.textContent ?? "";
          const name = (inp as HTMLInputElement).name ?? "";
          if ((label.includes("Employer") && label.includes("RRSP")) || (name.includes("Employer") && name.includes("RRSP"))) {
            if ((inp as HTMLInputElement).type === "text" || (inp as HTMLInputElement).type === "number") {
              const el = inp as HTMLInputElement;
              el.value = val;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }, rrspEmployerPerPeriod),
      "fill employer RRSP"
    );
    if (fillResult.isErr()) { await cleanup(); return err(fillResult.error); }
  }

  // Employee RRSP
  if (config.rrspEmployeePercent > 0) {
    log("checking employee RRSP...");
    const checkResult = await safe(
      page.$$eval("input[type='checkbox']", (boxes) => {
        const cb = boxes.find((b: any) => {
          const label = b.labels?.[0]?.textContent ?? b.name ?? "";
          return label.includes("Employee") && label.includes("RRSP");
        });
        if (cb && !(cb as HTMLInputElement).checked) (cb as HTMLInputElement).click();
        return !!cb;
      }),
      "check employee RRSP"
    );
    if (checkResult.isErr()) { await cleanup(); return err(checkResult.error); }

    await sleep(500); // Wait for field to appear

    const fillResult = await safe(
      page.$$eval("input[type='text'], input[type='number']", (inputs, val) => {
        for (const inp of inputs) {
          const label = (inp as any).labels?.[0]?.textContent ?? "";
          const name = (inp as HTMLInputElement).name ?? "";
          if (label.includes("deduct at source") || (name.includes("Employee") && name.includes("RRSP") && name.includes("deduct"))) {
            const el = inp as HTMLInputElement;
            el.value = val;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }, rrspEmployeePerPeriod),
      "fill employee RRSP"
    );
    if (fillResult.isErr()) { await cleanup(); return err(fillResult.error); }
  }

  // Click Next
  const nextStep2 = await click(page, 'button[type="submit"], button.btn-primary', "Next step 2");
  if (nextStep2.isErr()) { await cleanup(); return err(nextStep2.error); }

  const step3 = await waitForNav(page, "step3");
  if (step3.isErr()) { await cleanup(); return err(step3.error); }

  // ── Step 3 — CPP / EI ──
  log("filling step 3...");

  if (config.cppMaxedOut) {
    const cppResult = await safe(
      page.$$eval("input[type='radio']", (radios) => {
        const r = radios.find((el: any) => {
          const label = el.labels?.[0]?.textContent ?? "";
          return label.includes("CPP") && label.includes("second additional") && label.includes("maximum");
        });
        if (r) { (r as HTMLInputElement).click(); return true; }
        return false;
      }),
      "select CPP maxed"
    );
    if (cppResult.isErr()) log(`CPP radio warning: ${cppResult.error}`);
  }

  if (config.eiMaxedOut) {
    const eiResult = await safe(
      page.$$eval("input[type='radio']", (radios) => {
        const r = radios.find((el: any) => {
          const label = el.labels?.[0]?.textContent ?? "";
          return label.includes("EI") && label.includes("maximum") && label.includes("premium");
        });
        if (r) { (r as HTMLInputElement).click(); return true; }
        return false;
      }),
      "select EI maxed"
    );
    if (eiResult.isErr()) log(`EI radio warning: ${eiResult.error}`);
  }

  // Click Calculate
  const calcBtn = await safe(
    page.$$eval("button", (buttons) => {
      const b = buttons.find((el: any) => el.textContent?.includes("Calculate"));
      if (b) { (b as HTMLButtonElement).click(); return true; }
      return false;
    }),
    "click Calculate"
  );
  if (calcBtn.isErr()) { await cleanup(); return err(calcBtn.error); }

  const resultsNav = await waitForNav(page, "results");
  if (resultsNav.isErr()) { await cleanup(); return err(resultsNav.error); }

  // ── Results ──
  log("waiting for results...");
  const resultsReady = await retry(
    () => ResultAsync.fromPromise(
      page.waitForFunction(
        () => (document.querySelector("main")?.innerText ?? "").includes("Net amount"),
        { timeout: PAGE_TIMEOUT }
      ),
      (e: any) => `results render: ${e.message ?? e}`
    ),
    2, 0, "results render"
  );

  if (resultsReady.isErr()) {
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "").catch(() => "(could not read page)");
    log("page content on failure:\n" + bodyText);
    await cleanup();
    return err(`Results page did not render — 'Net amount' not found. Page: ${String(bodyText).slice(0, 100)}`);
  }

  const text = await safe(
    page.evaluate(() => document.querySelector("main")?.innerText ?? ""),
    "read results text"
  );
  if (text.isErr()) { await cleanup(); return err(text.error); }

  log("got results, parsing...");
  const parsed = parseResults(text.value, config, periodsPerYear);

  log("closing browser");
  await browser.close().catch(() => {});

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
