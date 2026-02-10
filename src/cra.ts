/**
 * CRA PDOC wizard automation.
 * Each step is a function: (session, config) → Result.
 * Reads like a script — no DOM noise.
 */
import { ok, err, type Result } from "neverthrow";
import { type BrowserSession, launchSession, retry, log } from "./browser";
import { PAY_PERIODS, type PayrollConfig, type PayrollResult } from "./types";
import { parseResults } from "./parse";

const CRA_URL = "https://apps.cra-arc.gc.ca/ebci/rhpd/beta/entry";

// ── Step runners ────────────────────────────────────────────

const loadEntryPage = async (session: BrowserSession): Promise<Result<void, string>> =>
  retry(
    async () => {
      const nav = await session.goto(CRA_URL);
      if (nav.isErr()) return nav;
      return session.waitForButton();
    },
    3, 1000, "entry page"
  );

const advancePastEntry = async (session: BrowserSession): Promise<Result<void, string>> => {
  const click = await session.clickButton("Next");
  if (click.isErr()) return click;
  return session.waitForPageReady("step1");
};

const fillEmployeeInfo = async (
  session: BrowserSession,
  config: PayrollConfig
): Promise<Result<void, string>> => {
  log("filling step 1...");

  const province = await session.selectByLabel("Province", config.province);
  if (province.isErr()) return province;
  log(`province: ${config.province}`);

  const payPeriod = await session.selectByLabel("Pay period", config.payPeriod);
  if (payPeriod.isErr()) return payPeriod;
  log(`pay period: ${config.payPeriod}`);

  const year = await session.selectYear(config.year);
  if (year.isErr()) return err(year.error);
  log(`year: ${year.value}`);

  await session.selectDateMonth("January");
  log("month: January");

  await session.selectDateDay("15");
  log("day: 15");

  await session.settle();

  const next = await session.clickButton("Next");
  if (next.isErr()) return next;
  return session.waitForPageReady("step2");
};

const fillSalaryInfo = async (
  session: BrowserSession,
  config: PayrollConfig,
  salaryPerPeriod: string,
  rrspEmployerPerPeriod: string,
  rrspEmployeePerPeriod: string
): Promise<Result<void, string>> => {
  log("filling step 2...");

  const salary = await session.fillInputByLabel("Salary or wages", salaryPerPeriod);
  if (salary.isErr()) return salary;
  log(`salary: ${salaryPerPeriod}/period`);

  if (config.rrspEmployerPercent > 0) {
    log("setting employer RRSP...");
    await session.checkCheckboxByLabel("Employer");
    await session.settle();
    const fill = await session.fillInputByLabel("Employer", rrspEmployerPerPeriod);
    if (fill.isErr()) log(`employer RRSP fill warning: ${fill.error}`);
    else log(`employer RRSP: ${rrspEmployerPerPeriod}/period`);
  }

  if (config.rrspEmployeePercent > 0) {
    log("setting employee RRSP...");
    await session.checkCheckboxByLabel("Employee");
    await session.settle();
    const fill = await session.fillInputByLabel("deduct at source", rrspEmployeePerPeriod);
    if (fill.isErr()) log(`employee RRSP fill warning: ${fill.error}`);
    else log(`employee RRSP: ${rrspEmployeePerPeriod}/period`);
  }

  await session.settle();

  const next = await session.clickButton("Next");
  if (next.isErr()) return next;
  return session.waitForPageReady("step3");
};

const fillCppEi = async (
  session: BrowserSession,
  config: PayrollConfig
): Promise<Result<void, string>> => {
  log("filling step 3...");

  if (config.cppMaxedOut) {
    await session.clickRadioByLabel("CPP and second additional CPP");
    log("CPP maxed: checked");
  }

  if (config.eiMaxedOut) {
    await session.clickRadioByLabel("EI maximum annual premium has");
    log("EI maxed: checked");
  }

  await session.settle();

  const calc = await session.clickButton("Calculate");
  if (calc.isErr()) return calc;
  return session.waitForPageReady("results");
};

const readResults = async (session: BrowserSession): Promise<Result<string, string>> => {
  log("waiting for results...");

  const ready = await retry(
    () => session.waitForText("Net amount"),
    2, 0, "results render"
  );

  if (ready.isErr()) {
    const errors = await session.readErrors();
    const errorMsg = errors.isOk() && errors.value ? errors.value : ready.error;
    return err(`Results not found: ${errorMsg}`);
  }

  return session.readMainText();
};

// ── Error recovery ──────────────────────────────────────────
// Wraps a step so that on failure, form errors are captured and the browser is closed.

const withErrorRecovery = (session: BrowserSession) =>
  async <T>(step: Promise<Result<T, string>>): Promise<Result<T, string>> => {
    const result = await step;
    if (result.isErr()) {
      const errors = await session.readErrors();
      const extra = errors.isOk() && errors.value ? ` (form error: ${errors.value})` : "";
      await session.close();
      return err(result.error + extra);
    }
    return result;
  };

// ── Orchestrator ────────────────────────────────────────────

export const calculatePayroll = async (
  config: PayrollConfig,
  headless: boolean = false
): Promise<Result<PayrollResult, string>> => {
  const periodsPerYear = PAY_PERIODS[config.payPeriod];
  if (!periodsPerYear) return err(`Unknown pay period: "${config.payPeriod}"`);

  const salaryPerPeriod = (config.annualSalary / periodsPerYear).toFixed(2);
  const rrspEmployeePerPeriod = ((config.annualSalary * (config.rrspEmployeePercent / 100)) / periodsPerYear).toFixed(2);
  const rrspEmployerPerPeriod = ((config.annualSalary * (config.rrspEmployerPercent / 100)) / periodsPerYear).toFixed(2);

  const sessionResult = await launchSession(headless);
  if (sessionResult.isErr()) return err(sessionResult.error);
  const session = sessionResult.value;
  const guard = withErrorRecovery(session);

  const entry = await guard(loadEntryPage(session));
  if (entry.isErr()) return err(entry.error);
  log("entry page loaded");

  const advance = await guard(advancePastEntry(session));
  if (advance.isErr()) return err(advance.error);

  const step1 = await guard(fillEmployeeInfo(session, config));
  if (step1.isErr()) return err(step1.error);

  const step2 = await guard(fillSalaryInfo(session, config, salaryPerPeriod, rrspEmployerPerPeriod, rrspEmployeePerPeriod));
  if (step2.isErr()) return err(step2.error);

  const step3 = await guard(fillCppEi(session, config));
  if (step3.isErr()) return err(step3.error);

  const text = await guard(readResults(session));
  if (text.isErr()) return err(text.error);

  log("got results, parsing...");
  const parsed = parseResults(text.value, config, periodsPerYear);

  log("closing browser");
  await session.close();

  return parsed;
};
