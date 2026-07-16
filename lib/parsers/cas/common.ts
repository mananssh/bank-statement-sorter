/** Shared number/date/ISIN helpers for CAS parsers (pure, no DB). */

export const ISIN_RE = /\bIN[A-Z0-9]{10}\b/;

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "01-Aug-2026" (also "01/AUG/2026", "01 Aug 2026") → "2026-08-01". */
export function casDateToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

export const CAS_DATE_RE = /\d{1,2}-[A-Za-z]{3}-\d{4}/;

/**
 * "1,23,456.78" → 123456.78; "(1,234.56)" → -1234.56. Returns null for
 * anything that isn't a plain number token.
 */
export function parseCasNumber(raw: string): number | null {
  let s = raw.trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d[\d,]*(\.\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Rupee number → integer paise (rounded). */
export function toPaise(n: number): number {
  return Math.round(n * 100);
}

/** Does this token look like a CAS numeric cell? (digits with , . or parens) */
export function isNumberToken(raw: string): boolean {
  return parseCasNumber(raw) !== null;
}
