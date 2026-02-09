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
export function setVerbose(v: boolean) { verbose = v; }
export function log(msg: string) { if (verbose) console.error(`  [cra] ${msg}`); }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function safe<T>(p: Promise<T>, label: string): ResultAsync<T, string> {
  return ResultAsync.fromPromise(p, (e: any) => `${label}: ${e.message ?? e}`);
}

export async function retry<T>(
  fn: () => Promise<Result<T, string>>,
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

export function findChrome(): Result<string, string> {
  const candidates = CHROME_PATHS[process.platform] ?? [];
  for (const p of candidates) {
    try { statSync(p); return ok(p); } catch {}
  }
  return err(
    `Chrome not found. Install Google Chrome from https://www.google.com/chrome/\n` +
    `Searched: ${candidates.join(", ")}`
  );
}

// ── BrowserSession ──────────────────────────────────────────
// Wraps a Puppeteer Page with high-level, Result-returning methods.

export interface BrowserSession {
  goto(url: string): Promise<Result<void, string>>;
  waitForUrl(urlPart: string): Promise<Result<void, string>>;
  waitForText(text: string): Promise<Result<void, string>>;
  waitForButton(): Promise<Result<void, string>>;
  clickButton(textMatch: string): Promise<Result<void, string>>;
  selectByLabel(labelMatch: string, optionText: string): Promise<Result<void, string>>;
  selectLatestYear(): Promise<Result<string, string>>;
  selectDateMonth(month: string): Promise<Result<void, string>>;
  selectDateDay(day: string): Promise<Result<void, string>>;
  fillInputByLabel(labelMatch: string, value: string): Promise<Result<void, string>>;
  checkCheckboxByLabel(labelMatch: string): Promise<Result<void, string>>;
  clickRadioByLabel(labelMatch: string): Promise<Result<void, string>>;
  readMainText(): Promise<Result<string, string>>;
  readErrors(): Promise<Result<string | null, string>>;
  close(): Promise<void>;
  settle(): Promise<void>;
}

export async function launchSession(headless: boolean): Promise<Result<BrowserSession, string>> {
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
      return r.map(b => b as Browser);
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
}

function createSession(page: Page, browser: Browser): BrowserSession {
  return {
    async goto(url) {
      return safe(
        page.goto(url, { timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded" }).then(() => {}),
        "goto"
      );
    },

    async waitForUrl(urlPart) {
      log(`waiting for /${urlPart}...`);
      const nav = await safe(
        page.waitForFunction((p: string) => window.location.href.includes(p), { timeout: PAGE_TIMEOUT }, urlPart),
        `navigate to ${urlPart}`
      );
      if (nav.isErr()) return err(nav.error);

      // Wait for loading splash
      await safe(
        page.waitForFunction(() => {
          const body = document.body?.innerText ?? "";
          return !body.includes("Loading") || body.length > 200;
        }, { timeout: PAGE_TIMEOUT }),
        "loading splash"
      ).unwrapOr(undefined);

      // Wait for heading
      await safe(
        page.waitForSelector("main h1", { visible: true, timeout: ACTION_TIMEOUT }),
        "heading"
      ).unwrapOr(undefined);

      log(`on /${urlPart}`);
      return ok(undefined);
    },

    async waitForText(text) {
      return safe(
        page.waitForFunction((t: string) => (document.querySelector("main")?.innerText ?? "").includes(t), { timeout: PAGE_TIMEOUT }, text),
        `wait for "${text}"`
      ).map(() => undefined);
    },

    async waitForButton() {
      return safe(
        page.waitForSelector("button", { visible: true, timeout: PAGE_TIMEOUT }),
        "wait for button"
      ).map(() => undefined);
    },

    async clickButton(textMatch) {
      return safe(
        page.evaluate((text: string) => {
          const btn = Array.from(document.querySelectorAll("button"))
            .find(b => b.textContent?.includes(text));
          if (!btn) throw new Error(`Button "${text}" not found`);
          btn.click();
        }, textMatch),
        `click "${textMatch}"`
      );
    },

    async selectByLabel(labelMatch, optionText) {
      return safe(
        page.evaluate((match: string, text: string) => {
          for (const s of document.querySelectorAll("select")) {
            const label = (s as any).labels?.[0]?.textContent ?? "";
            const title = s.title ?? "";
            if (label.includes(match) || title.includes(match)) {
              const opt = Array.from(s.options).find(o => o.text.includes(text));
              if (!opt) throw new Error(`Option "${text}" not found in "${match}"`);
              s.value = opt.value;
              s.dispatchEvent(new Event("change", { bubbles: true }));
              s.dispatchEvent(new Event("input", { bubbles: true }));
              return;
            }
          }
          throw new Error(`Select "${match}" not found`);
        }, labelMatch, optionText),
        `select ${labelMatch}="${optionText}"`
      );
    },

    async selectLatestYear() {
      const result = await safe(
        page.evaluate(() => {
          const s = Array.from(document.querySelectorAll("select"))
            .find(el => el.id === "datePaidYear" || el.title?.toLowerCase().includes("year"));
          if (!s) throw new Error("Year select not found");
          const years = Array.from(s.options).map(o => parseInt(o.value)).filter(n => !isNaN(n)).sort((a, b) => b - a);
          if (!years.length) throw new Error("No valid years");
          s.value = years[0].toString();
          s.dispatchEvent(new Event("change", { bubbles: true }));
          s.dispatchEvent(new Event("input", { bubbles: true }));
          return years[0].toString();
        }),
        "select year"
      );
      return result;
    },

    async selectDateMonth(month) {
      return safe(
        page.evaluate((m: string) => {
          const s = Array.from(document.querySelectorAll("select"))
            .find(el => el.id === "datePaidMonth" || el.title?.toLowerCase().includes("month"));
          if (!s) return;
          const opt = Array.from(s.options).find(o => o.text.includes(m));
          if (opt) {
            s.value = opt.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            s.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }, month),
        "select month"
      );
    },

    async selectDateDay(day) {
      return safe(
        page.evaluate((d: string) => {
          const s = Array.from(document.querySelectorAll("select"))
            .find(el => el.id === "datePaidDay" || el.title?.toLowerCase().includes("day"));
          if (!s) return;
          const opt = Array.from(s.options).find(o => o.value === d);
          if (opt) {
            s.value = opt.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            s.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }, day),
        "select day"
      );
    },

    async fillInputByLabel(labelMatch, value) {
      return safe(
        page.evaluate((match: string, val: string) => {
          for (const inp of document.querySelectorAll("input")) {
            const label = (inp as any).labels?.[0]?.textContent ?? "";
            const name = inp.name ?? "";
            if (label.includes(match) || name.includes(match)) {
              if (inp.type !== "checkbox" && inp.type !== "radio" && inp.offsetParent !== null) {
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
      );
    },

    async checkCheckboxByLabel(labelMatch) {
      return safe(
        page.evaluate((match: string) => {
          const cb = Array.from(document.querySelectorAll("input[type='checkbox']"))
            .find((b: any) => {
              const label = b.labels?.[0]?.textContent ?? b.name ?? "";
              return label.includes(match);
            }) as HTMLInputElement | undefined;
          if (cb && !cb.checked) cb.click();
        }, labelMatch),
        `check "${labelMatch}"`
      );
    },

    async clickRadioByLabel(labelMatch) {
      return safe(
        page.evaluate((match: string) => {
          const radio = Array.from(document.querySelectorAll("input[type='radio']"))
            .find((r: any) => (r.labels?.[0]?.textContent ?? "").includes(match)) as HTMLInputElement | undefined;
          if (radio) radio.click();
        }, labelMatch),
        `radio "${labelMatch}"`
      );
    },

    async readMainText() {
      return safe(
        page.evaluate(() => document.querySelector("main")?.innerText ?? ""),
        "read main"
      );
    },

    async readErrors() {
      const text = await page.evaluate(() => {
        const els = document.querySelectorAll('.error, .alert-danger, [role="alert"], .text-danger');
        const texts: string[] = [];
        els.forEach(el => {
          const t = (el as HTMLElement).innerText?.trim();
          if (t && t.length > 0 && !t.includes("Loading")) texts.push(t);
        });
        return texts.length ? texts.join("; ") : null;
      }).catch(() => null);
      return ok(text);
    },

    async close() { await browser.close().catch(() => {}); },
    async settle() { await sleep(300); },
  };
}
