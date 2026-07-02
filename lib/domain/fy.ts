/**
 * Financial-year helpers. The FY start month is configurable (settings key
 * 'fy_start_month'; 4 = April for India, 1 = calendar year). An FY is
 * identified by its start year: startYear 2025 with April start = FY2025-26.
 */

export function fyStartYear(isoDate: string, fyStartMonth: number): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= fyStartMonth ? year : year - 1;
}

export function fyLabel(startYear: number, fyStartMonth: number): string {
  if (fyStartMonth === 1) return `FY${startYear}`;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${startYear}-${endShort}`;
}

/** 'FY2025-26' or '2025-26' or '2025' → start year. Returns null if unparseable. */
export function parseFyLabel(label: string): number | null {
  const m = label.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function fyDateRange(startYear: number, fyStartMonth: number): { from: string; to: string } {
  const from = `${startYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
  const endYear = fyStartMonth === 1 ? startYear : startYear + 1;
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const to = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

/** Ordered list of 'YYYY-MM' month keys within an FY. */
export function fyMonths(startYear: number, fyStartMonth: number): string[] {
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((fyStartMonth - 1 + i) % 12) + 1;
    const y = startYear + (fyStartMonth - 1 + i >= 12 ? 1 : 0);
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
