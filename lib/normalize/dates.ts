/**
 * Statement date coercion. Sources are messy: the same bank exports Excel
 * serial numbers in one file and dd/mm/yy text in the next. Everything
 * normalizes to ISO 'YYYY-MM-DD'.
 */

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // 1900 date system
const MS_PER_DAY = 86_400_000;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject overflow like 31/02
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const date = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY);
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Coerce a raw cell value to ISO date. `dayFirst` matters only for ambiguous
 * numeric formats (dd/mm vs mm/dd); Indian statements are day-first.
 */
export function coerceDate(value: unknown, opts?: { dayFirst?: boolean }): string | null {
  const dayFirst = opts?.dayFirst ?? true;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") return excelSerialToIso(value);
  if (typeof value !== "string") return null;

  const s = value.trim();
  if (s === "") return null;

  // Numeric string that is actually an Excel serial
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));

  // ISO / ISO datetime
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // dd/mm/yy, dd-mm-yyyy, mm/dd/yy... (separator / - .), optional trailing time
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Disambiguate: if one part can't be a month, it's the day.
    if (a > 12 && b <= 12) return iso(y, b, a);
    if (b > 12 && a <= 12) return iso(y, a, b);
    return dayFirst ? iso(y, b, a) : iso(y, a, b);
  }

  // dd-MMM-yyyy / dd MMM yy ("01-Apr-2025", "1 Apr 25")
  m = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/](\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return iso(y, month, Number(m[1]));
  }

  return null;
}
