import type { Grid } from "@/lib/parsers/types";

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Normalize a header cell for fingerprinting/matching: "Chq./Ref.No." -> "chq ref no" */
export function normalizeHeaderCell(value: unknown): string {
  return cellToString(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim a grid to a bounded preview of stringified cells for client rendering. */
export function gridPreview(grid: Grid, maxRows = 40, maxCols = 20): string[][] {
  const width = Math.min(maxCols, Math.max(0, ...grid.slice(0, maxRows).map((r) => r.length)));
  return grid.slice(0, maxRows).map((row) => {
    const cells: string[] = [];
    for (let c = 0; c < width; c++) cells.push(cellToString(row[c]));
    return cells;
  });
}

export function rowIsEmpty(row: unknown[] | undefined): boolean {
  return !row || row.every((c) => c === null || c === undefined || cellToString(c) === "");
}
