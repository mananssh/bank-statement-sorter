import type { AmountStyle, Channel, Direction, StatementKind } from "@/lib/db/types";

/**
 * Canonical source fields a statement column can map to. Which ones apply
 * depends on the statement kind. `amount`+`drcr` and `debit`+`credit` are
 * alternative amount styles.
 */
export const BANK_FIELDS = [
  "date",
  "narration",
  "ref_number",
  "value_date",
  "debit",
  "credit",
  "amount",
  "drcr",
  "balance",
] as const;

export const MF_FIELDS = [
  "order_no",
  "order_date",
  "isin",
  "scheme_name",
  "folio",
  "side",
  "units",
  "nav",
  "amount",
] as const;

export type CanonicalField = (typeof BANK_FIELDS)[number] | (typeof MF_FIELDS)[number];

/** canonical field -> 0-based column index in the sheet grid */
export type ColumnMap = Partial<Record<CanonicalField, number>>;

export interface MappingSpec {
  statementKind: StatementKind;
  headerRow: number | null; // 0-based row index in grid
  dataStartRow: number; // 0-based
  columnMap: ColumnMap;
  amountStyle: AmountStyle;
  narrationPlugin: string | null;
  dayFirst?: boolean;
}

export interface CanonicalTxn {
  row_no: number;
  txn_date: string;
  narration: string;
  ref_number: string | null;
  direction: Direction;
  amount_paise: number;
  balance_paise: number | null;
  channel: Channel | null;
  counterparty_raw: string | null;
  counterparty_vpa: string | null;
  upi_rrn: string | null;
  upi_note: string | null;
  parsed: Record<string, unknown>;
}

export interface CanonicalMfOrder {
  row_no: number;
  order_no: string | null;
  order_date: string;
  isin: string | null;
  scheme_name: string;
  folio: string | null;
  side: "buy" | "sell";
  units: number | null;
  nav: number | null;
  amount_paise: number;
}

export interface ParseIssue {
  row_no: number;
  raw: unknown[];
  error: string;
}

export interface ParseResult {
  txns: CanonicalTxn[];
  mfOrders: CanonicalMfOrder[];
  issues: ParseIssue[];
}

/** A sheet as a matrix of raw cell values (numbers preserved for serial dates). */
export type Grid = unknown[][];
