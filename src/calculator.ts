/**
 * Calculator module — thin wrapper.
 * Re-exports types and wires the CRA service.
 */
export type { PayrollConfig, PayrollResult } from "./types";
export { PAY_PERIODS } from "./types";
export { setVerbose } from "./browser";
export { parseResults } from "./parse";
export { calculatePayroll } from "./cra";
import { calculatePayroll } from "./cra";
import type { PayrollService } from "./types";

export const craService: PayrollService = {
  calculate: calculatePayroll,
};
