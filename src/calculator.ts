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

/** Select an option by finding the <select> via label text and using evaluate to set + dispatch */
async function selectByLabel(page: Page, labelMatch: string, optionText: string): Promise<Result<void, string>> {
  const result = await safe(
    page.evaluate((match: string, text: string) => {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const s of selects) {
        const label = (s as any).labels?.[0]?.textContent ?? "";
        const title = s.title ?? "";
        if (label.includes(match) || title.includes(match)) {
          const opts = Array.from(s.options);
          const opt = opts.find(o => o.text.includes(text));
          if (opt) {
            s.value = opt.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            s.dispatchEvent(new Event("input", { bubbles: true }));
            // Also trigger Angular's ngModel change detection
            const ev = new Event("change", { bubbles: true });
            Object.defineProperty(ev, "target", { value: s });
            s.dispatchEvent(ev);
            return { ok: true };
          }
          return { ok: false, error: `Option "${text}" not found` };
        }
      }
      return { ok: false, error: `Select with label "${match}" not found` };
    }, labelMatch, optionText),
    `select ${labelMatch}=${optionText}`
  );
  if (result.isErr()) return err(result.error);
  if (!result.value.ok) return err(result.value.error!);
  return ok(undefined);
}

/** Select by element ID using evaluate (avoids CSS selector issues with UUIDs) */
async function selectById(page: Page, id: string, value: string): Promise<Result<void, string>> {
  const cleanId = id.replace(/^#/, "");
  const result = await safe(
    page.evaluate((elId: string, val: string) => {
      const s = document.getElementById(elId) as HTMLSelectElement | null;
      if (!s) return false;
      s.value = val;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      s.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, cleanId, value),
    `select #${cleanId}=${value}`
  );
  if (result.isErr()) return err(result.error);
  if (!result.value) return err(`Element #${cleanId} not found`);
  return ok(undefined);
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

/** Clear and type into an input using keyboard events (not .value =) */
async function clearAndType(page: Page, selector: string, value: string, label: string): Promise<Result<void, string>> {
  const el = await safe(page.waitForSelector(selector, { visible: true, timeout: ACTION_TIMEOUT }), `find ${label}`);
  if (el.isErr()) return err(el.error);
  // Triple click to select all, then type to replace
  await el.value!.click({ clickCount: 3 });
  return safe(page.keyboard.type(value), `type ${label}`);
}

/** Check for validation errors on the page */
async function checkForErrors(page: Page): Promise<Result<void, string>> {
  const errorText = await page.evaluate(() => {
    // Look for common error patterns on CRA forms
    const errorEls = document.querySelectorAll('.error, .alert-danger, [role="alert"], .text-danger, .error-message');
    const texts: string[] = [];
    errorEls.forEach(el => {
      const t = (el as HTMLElement).innerText?.trim();
      if (t && t.length > 0 && !t.includes("Loading")) texts.push(t);
    });
    return texts.join("; ");
  }).catch(() => "");

  if (errorText) {
    log(`form errors detected: ${errorText}`);
    return err(`CRA form validation error: ${errorText}`);
  }
  return ok(undefined);
}

/** Click Next and handle either navigation or validation error */
async function clickNextAndAdvance(page: Page, buttonSelector: string, nextUrlPart: string, label: string, cleanup: () => Promise<void>): Promise<Result<void, string>> {
  const clickResult = await click(page, buttonSelector, label);
  if (clickResult.isErr()) { await cleanup(); return err(clickResult.error); }

  // Race: either we navigate to the next step, or errors appear
  const navResult = await waitForNav(page, nextUrlPart);
  if (navResult.isErr()) {
    // Check if there's a validation error on the page
    const errors = await checkForErrors(page);
    if (errors.isErr()) {
      await cleanup();
      return err(errors.error);
    }
    await cleanup();
    return err(navResult.error);
  }
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
      (e: any) => {
        const msg = e.message ?? String(e);
        if (msg.includes("Executable doesn't exist") || msg.includes("Cannot find")) {
          return `Chrome not found. Install Google Chrome from https://www.google.com/chrome/\n\n(${msg})`;
        }
        return msg;
      }
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
  const step1Nav = await clickNextAndAdvance(page, 'button[type="submit"], button.btn-primary', "step1", "Next entry", cleanup);
  if (step1Nav.isErr()) return err(step1Nav.error);

  // ── Step 1 — Employee info ──
  log("filling step 1...");

  // Province — use page.select() for proper event firing
  const provSelect = await selectByLabel(page, "Province", config.province);
  if (provSelect.isErr()) { await cleanup(); return err(provSelect.error); }
  log(`province: ${config.province}`);

  // Pay period
  const ppSelect = await selectByLabel(page, "Pay period", config.payPeriod);
  if (ppSelect.isErr()) { await cleanup(); return err(ppSelect.error); }
  log(`pay period: ${config.payPeriod}`);

  // Year — find latest and select it
  const yearResult = await safe(
    page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const s = selects.find(el => el.id === "datePaidYear" || el.title?.toLowerCase().includes("year"));
      if (!s) return null;
      const opts = Array.from(s.options)
        .map(o => parseInt(o.value))
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a);
      if (opts.length === 0) return null;
      s.value = opts[0].toString();
      s.dispatchEvent(new Event("change", { bubbles: true }));
      s.dispatchEvent(new Event("input", { bubbles: true }));
      return opts[0].toString();
    }),
    "select year"
  );
  if (yearResult.isErr()) { await cleanup(); return err(yearResult.error); }
  if (!yearResult.value) { await cleanup(); return err("No valid years in dropdown"); }
  log(`year: ${yearResult.value}`);

  // Month — select January
  const monthResult = await safe(
    page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const s = selects.find(el => el.id === "datePaidMonth" || el.title?.toLowerCase().includes("month"));
      if (!s) return false;
      const opts = Array.from(s.options);
      const jan = opts.find(o => o.text.includes("January") || o.value === "1" || o.value === "01");
      if (jan) {
        s.value = jan.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        s.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    }),
    "select month"
  );
  if (monthResult.isOk()) log("month: January");

  // Day — select 15
  const dayResult = await safe(
    page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const s = selects.find(el => el.id === "datePaidDay" || el.title?.toLowerCase().includes("day"));
      if (!s) return false;
      const d15 = Array.from(s.options).find(o => o.value === "15");
      if (d15) {
        s.value = d15.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        s.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    }),
    "select day"
  );
  if (dayResult.isOk()) log("day: 15");

  // Small delay to let Angular digest the changes
  await sleep(300);

  // Click Next → step2
  const step2Nav = await clickNextAndAdvance(page, 'button[type="submit"], button.btn-primary', "step2", "Next step 1", cleanup);
  if (step2Nav.isErr()) return err(step2Nav.error);

  // ── Step 2 — Salary info ──
  log("filling step 2...");

  // Fill salary using evaluate to find by label, then keyboard to type
  const salaryFill = await safe(
    page.evaluate((val: string) => {
      const inputs = Array.from(document.querySelectorAll("input"));
      for (const inp of inputs) {
        const label = (inp as any).labels?.[0]?.textContent ?? "";
        const name = inp.name ?? "";
        if (label.includes("Salary or wages") || name.includes("Salary") || name.includes("salary")) {
          inp.focus();
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, salaryPerPeriod),
    "fill salary"
  );
  if (salaryFill.isErr()) { await cleanup(); return err(salaryFill.error); }
  if (!salaryFill.value) { await cleanup(); return err("Salary input not found"); }
  log(`salary: ${salaryPerPeriod}/period`);

  // Employer RRSP
  if (config.rrspEmployerPercent > 0) {
    log("checking employer RRSP...");
    await safe(
      page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
        const cb = boxes.find((b: any) => {
          const label = b.labels?.[0]?.textContent ?? b.name ?? "";
          return label.includes("Employer") && label.includes("RRSP");
        }) as HTMLInputElement | undefined;
        if (cb && !cb.checked) cb.click();
        return !!cb;
      }),
      "check employer RRSP"
    );
    await sleep(500);

    const fillResult = await safe(
      page.evaluate((val: string) => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const inp of inputs) {
          const label = (inp as any).labels?.[0]?.textContent ?? "";
          const name = inp.name ?? "";
          if ((label.includes("Employer") && label.includes("RRSP")) ||
              (name.includes("Employer") && name.includes("RRSP"))) {
            if (inp.type !== "checkbox" && inp.offsetParent !== null) {
              inp.focus();
              inp.value = val;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }, rrspEmployerPerPeriod),
      "fill employer RRSP"
    );
    if (fillResult.isOk()) log(`employer RRSP: ${rrspEmployerPerPeriod}/period`);
  }

  // Employee RRSP
  if (config.rrspEmployeePercent > 0) {
    log("checking employee RRSP...");
    await safe(
      page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
        const cb = boxes.find((b: any) => {
          const label = b.labels?.[0]?.textContent ?? b.name ?? "";
          return label.includes("Employee") && label.includes("RRSP");
        }) as HTMLInputElement | undefined;
        if (cb && !cb.checked) cb.click();
        return !!cb;
      }),
      "check employee RRSP"
    );
    await sleep(500);

    const fillResult = await safe(
      page.evaluate((val: string) => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const inp of inputs) {
          const label = (inp as any).labels?.[0]?.textContent ?? "";
          const name = inp.name ?? "";
          if (label.includes("deduct at source") ||
              (name.includes("Employee") && name.includes("RRSP") && name.includes("deduct"))) {
            if (inp.type !== "checkbox" && inp.offsetParent !== null) {
              inp.focus();
              inp.value = val;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }, rrspEmployeePerPeriod),
      "fill employee RRSP"
    );
    if (fillResult.isOk()) log(`employee RRSP: ${rrspEmployeePerPeriod}/period`);
  }

  await sleep(300);

  // Click Next → step3
  const step3Nav = await clickNextAndAdvance(page, 'button[type="submit"], button.btn-primary', "step3", "Next step 2", cleanup);
  if (step3Nav.isErr()) return err(step3Nav.error);

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
    log("CPP maxed: checked");
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
    log("EI maxed: checked");
  }

  await sleep(300);

  // Click Calculate → results
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
  if (resultsNav.isErr()) {
    const errors = await checkForErrors(page);
    if (errors.isErr()) { await cleanup(); return err(errors.error); }
    await cleanup();
    return err(resultsNav.error);
  }

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
