/** Shared formatting helpers for views. */

export const money = (n: number) =>
  n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const line = (ch: string, width: number) => ch.repeat(width);
