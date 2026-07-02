/**
 * Money is stored everywhere as integer minor units (paise for INR).
 * These helpers convert between minor units, decimal numbers, and
 * display strings with Indian digit grouping (1,23,456.78).
 */

export function toPaise(value: number): number {
  return Math.round(value * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Parse "1,23,456.78", "₹ 1,234.00", "1234.5 Cr" → paise (sign ignored; use the flag/columns for direction). */
export function parseAmountToPaise(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.abs(toPaise(raw)) : null;
  }
  const cleaned = raw
    .replace(/[₹$€£,\s]/g, "")
    .replace(/(dr|cr)\.?$/i, "")
    .replace(/^\((.*)\)$/, "$1"); // accounting negatives "(123.45)"
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(toPaise(n)) : null;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatPaise(paise: number, opts?: { symbol?: string; compact?: boolean }): string {
  const symbol = opts?.symbol ?? "₹";
  const rupees = paise / 100;
  if (opts?.compact) return `${symbol}${inrCompact.format(rupees)}`;
  return `${symbol}${inrFormatter.format(rupees)}`;
}
