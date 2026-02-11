/**
 * Calculator module — thin wrapper.
 * Re-exports types and wires the CRA service with caching.
 */
export type { PayrollConfig, PayrollResult } from "./types";
export { PAY_PERIODS } from "./types";
export { setVerbose } from "./browser";
export { parseResults } from "./parse";
export { calculatePayroll } from "./cra";
import { calculatePayroll } from "./cra";
import { withCache } from "./cache";
import type { PayrollService } from "./types";

const rawService: PayrollService = {
  calculate: calculatePayroll,
};

export const craService: PayrollService = withCache(rawService);
export const craServiceNoCache: PayrollService = rawService;
