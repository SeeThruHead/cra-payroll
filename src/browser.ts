/**
 * Browser abstraction over Puppeteer.
 * Hides all DOM evaluation, event dispatching, and selector noise.
 * Every method returns Result<T, string>.
 */
import puppeteer, { type Page, type Browser } from "puppeteer-core";
import { ok, err, type Result, ResultAsync } from "neverthrow";
import { statSync } from "fs";

const LAUNCH_TIMEOUT = 5_000;
const PAGE_TIMEOUT = 5_000;
const ACTION_TIMEOUT = 3_000;

let verbose = false;
export const setVerbose = (v: boolean) => { verbose = v; };
export const log = (msg: string) => { if (verbose) console.error(`  [cra] ${msg}`); };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const safe = <T>(p: Promise<T>, label: string): ResultAsync<T, string> =>
  ResultAsync.fromPromise(p, (e: any) => `${label}: ${e.message ?? e}`);

export const retry = async <T>(
  fn: () => Promise<Result<T, string>>,
  attempts: number,
  delayMs: number,
  label: string
): Promise<Result<T, string>> => {
  for (let i = 1; i <= attempts; i++) {
    log(`${label} (attempt ${i})...`);
    const result = await fn();
    if (result.isOk()) return result;
    log(`${label} attempt ${i} failed: ${result.error}`);
    if (i < attempts) await sleep(delayMs);
  }
  return err(`${label} failed after ${attempts} attempts`);
};

// ── Chrome discovery ────────────────────────────────────────

const CHROME_PATHS: Record<string, string[]> = {
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

export const findChrome = (): Result<string, string> => {
  const candidates = CHROME_PATHS[process.platform] ?? [];
  for (const p of candidates) {
    try { statSync(p); return ok(p); } catch {}
  }
  return err(
    `Chrome not found. Install Google Chrome from https://www.google.com/chrome/\n` +
    `Searched: ${candidates.join(", ")}`
  );
};

// ── BrowserSession ──────────────────────────────────────────

export interface BrowserSession {
  // Navigation
  goto(url: string): Promise<Result<void, string>>;
  waitForPageReady(urlPart: string): Promise<Result<void, string>>;
  waitForText(text: string): Promise<Result<void, string>>;
  waitForButton(): Promise<Result<void, string>>;

  // Form interaction
  clickButton(textMatch: string): Promise<Result<void, string>>;
  selectByLabel(labelMatch: string, optionText: string): Promise<Result<void, string>>;
  selectLatestYear(): Promise<Result<string, string>>;
  selectDateMonth(month: string): Promise<Result<void, string>>;
  selectDateDay(day: string): Promise<Result<void, string>>;
  fillInputByLabel(labelMatch: string, value: string): Promise<Result<void, string>>;
  checkCheckboxByLabel(labelMatch: string): Promise<Result<void, string>>;
  clickRadioByLabel(labelMatch: string): Promise<Result<void, string>>;

  // Reading
  readMainText(): Promise<Result<string, string>>;
  readErrors(): Promise<Result<string | null, string>>;

  // Lifecycle
  close(): Promise<void>;
  settle(): Promise<void>;
}

// ── Launch ──────────────────────────────────────────────────

export const launchSession = async (headless: boolean): Promise<Result<BrowserSession, string>> => {
  const chromePath = findChrome();
  if (chromePath.isErr()) return err(chromePath.error);
  log(`using Chrome: ${chromePath.value}`);

  const browserResult = await retry(
    async () => {
      const r = await safe(
        Promise.race([
          puppeteer.launch({
            headless,
            executablePath: chromePath.value,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("launch timed out")), LAUNCH_TIMEOUT)
          ),
        ]),
        "browser launch"
      );
      return r;
    },
    3, 1000, "browser launch"
  );
  if (browserResult.isErr()) return err(browserResult.error);

  const browser = browserResult.value;
  log("browser launched");

  const pageResult = await safe(browser.newPage(), "create page");
  if (pageResult.isErr()) {
    await browser.close().catch(() => {});
    return err(pageResult.error);
  }

  const page = pageResult.value;
  page.setDefaultTimeout(ACTION_TIMEOUT);

  return ok(createSession(page, browser));
};

// ── Session factory ─────────────────────────────────────────

const navigationMethods = (page: Page) => ({
  goto: async (url: string) =>
    safe(
      page.goto(url, { timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded" }).then(() => {}),
      "goto"
    ),

  waitForPageReady: async (urlPart: string): Promise<Result<void, string>> => {
    log(`waiting for /${urlPart}...`);

    const navigated = await safe(
      page.waitForFunction((p: string) => window.location.href.includes(p), { timeout: PAGE_TIMEOUT }, urlPart),
      `navigate to ${urlPart}`
    );
    if (navigated.isErr()) return err(navigated.error);

    // Best-effort: let Angular's loading splash clear before interacting
    await safe(
      page.waitForFunction(() => {
        const body = document.body?.innerText ?? "";
        return !body.includes("Loading") || body.length > 200;
      }, { timeout: PAGE_TIMEOUT }),
      "loading splash"
    ).unwrapOr(undefined);

    // Best-effort: wait for main heading to render
    await safe(
      page.waitForSelector("main h1", { visible: true, timeout: ACTION_TIMEOUT }),
      "heading"
    ).unwrapOr(undefined);

    log(`on /${urlPart}`);
    return ok(undefined);
  },

  waitForText: async (text: string) =>
    safe(
      page.waitForFunction((t: string) => (document.querySelector("main")?.innerText ?? "").includes(t), { timeout: PAGE_TIMEOUT }, text),
      `wait for "${text}"`
    ).map(() => undefined),

  waitForButton: async () =>
    safe(
      page.waitForSelector("button", { visible: true, timeout: PAGE_TIMEOUT }),
      "wait for button"
    ).map(() => undefined),
});

const formMethods = (page: Page) => ({
  clickButton: async (textMatch: string) =>
    safe(
      page.evaluate((text: string) => {
        const btn = Array.from(document.querySelectorAll("button"))
          .find(b => b.textContent?.includes(text));
        if (!btn) throw new Error(`Button "${text}" not found`);
        btn.click();
      }, textMatch),
      `click "${textMatch}"`
    ),

  selectByLabel: async (labelMatch: string, optionText: string) =>
    safe(
      page.evaluate((match: string, text: string) => {
        const fireChangeEvents = (el: HTMLElement) => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };

        const labelFor = (el: HTMLElement) =>
          el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "" : "";

        for (const s of document.querySelectorAll("select")) {
          const label = labelFor(s);
          const title = s.title ?? "";
          if (label.includes(match) || title.includes(match)) {
            const opt = Array.from(s.options).find(o => o.text.includes(text));
            if (!opt) throw new Error(`Option "${text}" not found in "${match}"`);
            s.value = opt.value;
            fireChangeEvents(s);
            return;
          }
        }
        throw new Error(`Select "${match}" not found`);
      }, labelMatch, optionText),
      `select ${labelMatch}="${optionText}"`
    ),

  selectLatestYear: async () =>
    safe(
      page.evaluate(() => {
        const fireChangeEvents = (el: HTMLElement) => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };

        const s = Array.from(document.querySelectorAll("select"))
          .find(el => el.id === "datePaidYear" || el.title?.toLowerCase().includes("year"));
        if (!s) throw new Error("Year select not found");
        const years = Array.from(s.options).map(o => parseInt(o.value)).filter(n => !isNaN(n)).sort((a, b) => b - a);
        if (!years.length) throw new Error("No valid years");
        s.value = years[0].toString();
        fireChangeEvents(s);
        return years[0].toString();
      }),
      "select year"
    ),

  selectDateMonth: async (month: string) =>
    safe(
      page.evaluate((m: string) => {
        const fireChangeEvents = (el: HTMLElement) => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };

        const s = Array.from(document.querySelectorAll("select"))
          .find(el => el.id === "datePaidMonth" || el.title?.toLowerCase().includes("month"));
        if (!s) return;
        const opt = Array.from(s.options).find(o => o.text.includes(m));
        if (opt) {
          s.value = opt.value;
          fireChangeEvents(s);
        }
      }, month),
      "select month"
    ),

  selectDateDay: async (day: string) =>
    safe(
      page.evaluate((d: string) => {
        const fireChangeEvents = (el: HTMLElement) => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };

        const s = Array.from(document.querySelectorAll("select"))
          .find(el => el.id === "datePaidDay" || el.title?.toLowerCase().includes("day"));
        if (!s) return;
        const opt = Array.from(s.options).find(o => o.value === d);
        if (opt) {
          s.value = opt.value;
          fireChangeEvents(s);
        }
      }, day),
      "select day"
    ),

  fillInputByLabel: async (labelMatch: string, value: string) =>
    safe(
      page.evaluate((match: string, val: string) => {
        const isVisible = (el: HTMLElement) => el.offsetParent !== null;

        const labelFor = (el: HTMLElement) =>
          el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "" : "";

        for (const inp of document.querySelectorAll("input")) {
          const label = labelFor(inp);
          const name = inp.name ?? "";
          if (label.includes(match) || name.includes(match)) {
            if (inp.type !== "checkbox" && inp.type !== "radio" && isVisible(inp)) {
              inp.focus();
              inp.value = val;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.dispatchEvent(new Event("change", { bubbles: true }));
              return;
            }
          }
        }
        throw new Error(`Input "${match}" not found`);
      }, labelMatch, value),
      `fill "${labelMatch}"`
    ),

  checkCheckboxByLabel: async (labelMatch: string) =>
    safe(
      page.evaluate((match: string) => {
        const labelFor = (el: HTMLElement) =>
          el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "" : "";

        const cb = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='checkbox']"))
          .find(b => {
            const label = labelFor(b) || b.name;
            return label.includes(match);
          });
        if (cb && !cb.checked) cb.click();
      }, labelMatch),
      `check "${labelMatch}"`
    ),

  clickRadioByLabel: async (labelMatch: string) =>
    safe(
      page.evaluate((match: string) => {
        const labelFor = (el: HTMLElement) =>
          el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "" : "";

        const radio = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='radio']"))
          .find(r => (labelFor(r)).includes(match));
        if (radio) radio.click();
      }, labelMatch),
      `radio "${labelMatch}"`
    ),
});

const readMethods = (page: Page) => ({
  readMainText: async () =>
    safe(
      page.evaluate(() => document.querySelector("main")?.innerText ?? ""),
      "read main"
    ),

  readErrors: async (): Promise<Result<string | null, string>> => {
    const text = await page.evaluate(() => {
      const els = document.querySelectorAll<HTMLElement>('.error, .alert-danger, [role="alert"], .text-danger');
      const texts: string[] = [];
      els.forEach(el => {
        const t = el.innerText?.trim();
        if (t && t.length > 0 && !t.includes("Loading")) texts.push(t);
      });
      return texts.length ? texts.join("; ") : null;
    }).catch(() => null);
    return ok(text);
  },
});

const createSession = (page: Page, browser: Browser): BrowserSession => ({
  ...navigationMethods(page),
  ...formMethods(page),
  ...readMethods(page),
  close: async () => { await browser.close().catch(() => {}); },
  settle: async () => { await sleep(300); },
});
