/**
 * Stable category → chart-series color assignment. Color follows the entity:
 * a category keeps its hue everywhere (donut, tables, register) and across
 * filter changes, so slots are assigned by hashing the category id — never by
 * rank or render order.
 */

export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export function seriesColorFor(id: number): string {
  return SERIES_VARS[Math.abs(id * 2654435761) % SERIES_VARS.length];
}

/**
 * Distinct colors for a set of slices in one view (donut + its table). Assigns
 * by position so adjacent slices never collide; wraps only past 8 entries
 * (callers cap at 7 + "Other"). Returns a stable id → color map so the donut
 * and the table beside it always agree.
 */
export function assignSliceColors(ids: number[]): Map<number, string> {
  const map = new Map<number, string>();
  ids.forEach((id, i) => map.set(id, SERIES_VARS[i % SERIES_VARS.length]));
  return map;
}

export function directionColor(direction: "debit" | "credit"): string {
  return direction === "credit" ? "var(--credit)" : "var(--debit)";
}

export function categoryTypeColor(type: string | null | undefined): string {
  switch (type) {
    case "income":
      return "var(--credit)";
    case "expense":
      return "var(--debit)";
    case "investment":
      return "var(--investment)";
    case "transfer":
      return "var(--transfer)";
    default:
      return "var(--ink-muted)";
  }
}
