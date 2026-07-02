import { createHash } from "node:crypto";
import type { Grid, CanonicalField } from "@/lib/parsers/types";
import { normalizeHeaderCell, rowIsEmpty } from "@/lib/parsers/grid";

/**
 * Header detection: find the most header-like row near the top of the sheet,
 * fingerprint it, and auto-map columns by field vocabulary. Fingerprints tie
 * a sheet layout to a saved preset so repeat imports skip the mapping step.
 */

// Vocabulary of header spellings → canonical field. Matched on normalized cells.
const FIELD_VOCABULARY: Array<{ field: CanonicalField; patterns: RegExp[] }> = [
  { field: "date", patterns: [/^(txn |transaction |tran )?date$/, /^date .time$/] },
  { field: "value_date", patterns: [/^value (dt|date)$/] },
  { field: "narration", patterns: [/^narration$/, /^description$/, /^particulars$/, /^details$/, /^transaction (type|details|remarks)$/, /^remarks$/] },
  { field: "ref_number", patterns: [/^chq ?\.? ?\/? ?ref ?\.? ?no ?\.?$/, /^chq ref no$/, /^ref(erence)? ?(no|number)?$/, /^cheque (no|number)$/, /^utr( no)?$/] },
  { field: "debit", patterns: [/^(withdrawal|debit) ?(amt|amount)? ?\.?$/, /^withdrawal$/, /^dr( amount)?$/] },
  { field: "credit", patterns: [/^(deposit|credit) ?(amt|amount)? ?\.?$/, /^deposit$/, /^cr( amount)?$/] },
  { field: "amount", patterns: [/^amt$/, /^amount( \(inr\))?$/, /^base$/, /^total amount( rs)?$/] },
  { field: "drcr", patterns: [/^debit ?\/? ?credit$/, /^dr ?\/? ?cr$/, /^type$/, /^cr ?\/? ?dr$/] },
  { field: "balance", patterns: [/^(closing |running )?balance$/, /^closing balance$/, /^balance ?(amt|amount)?$/] },
  // MF order book
  { field: "order_no", patterns: [/^order ?(no|number)$/] },
  { field: "order_date", patterns: [/^order date$/] },
  { field: "isin", patterns: [/^isin$/] },
  { field: "scheme_name", patterns: [/^(name of )?(mf )?scheme( name)?$/, /^scheme$/, /^fund( name)?$/] },
  { field: "folio", patterns: [/^folio ?(no|number)?$/] },
  { field: "side", patterns: [/^buy ?\/? ?sell$/, /^side$/, /^transaction( type)?$/] },
  { field: "units", patterns: [/^(no of )?units$/, /^quantity$/] },
  { field: "nav", patterns: [/^nav$/, /^nav ?(rs|rate)?$/, /^price$/] },
];

export function matchFieldForHeader(cell: unknown): CanonicalField | null {
  const norm = normalizeHeaderCell(cell);
  if (!norm) return null;
  for (const { field, patterns } of FIELD_VOCABULARY) {
    if (patterns.some((p) => p.test(norm))) return field;
  }
  return null;
}

export function headerFingerprint(headerCells: unknown[]): string {
  const normalized = headerCells.map(normalizeHeaderCell).filter((c) => c !== "");
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export interface HeaderDetection {
  headerRow: number; // 0-based
  dataStartRow: number; // 0-based
  fingerprint: string;
  /** auto-derived column map from vocabulary hits */
  columnMap: Partial<Record<CanonicalField, number>>;
  score: number; // fraction of non-empty cells that matched vocabulary
}

/** Scan the first `scanRows` rows and pick the most header-like one. */
export function detectHeader(grid: Grid, scanRows = 25): HeaderDetection | null {
  let best: HeaderDetection | null = null;

  for (let r = 0; r < Math.min(scanRows, grid.length); r++) {
    const row = grid[r];
    if (rowIsEmpty(row)) continue;

    const nonEmpty = row.filter((c) => normalizeHeaderCell(c) !== "");
    if (nonEmpty.length < 3) continue;

    const columnMap: Partial<Record<CanonicalField, number>> = {};
    let hits = 0;
    row.forEach((cell, idx) => {
      const field = matchFieldForHeader(cell);
      if (field && columnMap[field] === undefined) {
        columnMap[field] = idx;
        hits++;
      }
    });

    const score = hits / nonEmpty.length;
    // A usable header needs a date column and either narration or an amount.
    const usable =
      columnMap.date !== undefined || columnMap.order_date !== undefined;
    if (!usable || score < 0.4) continue;

    let dataStartRow = r + 1;
    while (dataStartRow < grid.length && rowIsEmpty(grid[dataStartRow])) dataStartRow++;

    const candidate: HeaderDetection = {
      headerRow: r,
      dataStartRow,
      fingerprint: headerFingerprint(row),
      columnMap,
      score,
    };
    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

/** Fuzzy preset match: fraction of the preset's normalized headers present in this row. */
export function headerOverlap(headerCells: unknown[], presetHeaders: string[]): number {
  if (presetHeaders.length === 0) return 0;
  const present = new Set(headerCells.map(normalizeHeaderCell).filter(Boolean));
  const found = presetHeaders.filter((h) => present.has(h)).length;
  return found / presetHeaders.length;
}
