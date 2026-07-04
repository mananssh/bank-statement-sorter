import type { Database } from "better-sqlite3";
import { headerFingerprint } from "@/lib/parsers/detect";

/**
 * Bundled import presets. These are ordinary preset rows the user can edit or
 * delete; they just ship with the app so common Indian formats work with zero
 * mapping. Community presets are the same shape — JSON in, JSON out.
 */

interface BuiltinPreset {
  name: string;
  institution: string;
  account_type: "bank" | "credit_card" | "investment";
  statement_kind: "bank" | "credit_card" | "mf_orders";
  file_kind: "xlsx" | "xls" | "csv";
  headers: string[]; // literal header row used to compute the fingerprint
  data_start_offset: number; // rows after header where data starts
  column_map: Record<string, number>;
  amount_style: "debit_credit_columns" | "signed_amount" | "amount_with_drcr_flag";
  narration_plugin: string | null;
  notes: string;
}

const BUILTINS: BuiltinPreset[] = [
  {
    name: "HDFC Bank statement (xlsx/xls)",
    institution: "HDFC Bank",
    account_type: "bank",
    statement_kind: "bank",
    file_kind: "xlsx",
    headers: [
      "Date",
      "Narration",
      "Chq./Ref.No.",
      "Value Dt",
      "Withdrawal Amt.",
      "Deposit Amt.",
      "Closing Balance",
    ],
    data_start_offset: 1,
    column_map: {
      date: 0,
      narration: 1,
      ref_number: 2,
      value_date: 3,
      debit: 4,
      credit: 5,
      balance: 6,
    },
    amount_style: "debit_credit_columns",
    narration_plugin: "hdfc",
    notes: "Standard HDFC netbanking statement export.",
  },
  {
    name: "HDFC Credit Card statement (Tata Neu, .xls)",
    institution: "HDFC Bank",
    account_type: "credit_card",
    statement_kind: "credit_card",
    file_kind: "xls",
    headers: ["Transaction type", "DATE", "Base", "NeuCoins", "Debit / Credit"],
    data_start_offset: 1,
    column_map: { narration: 0, date: 1, amount: 2, drcr: 4 },
    amount_style: "amount_with_drcr_flag",
    narration_plugin: "generic",
    notes: "Monthly billed-statement .xls export for Tata Neu HDFC cards.",
  },
  {
    name: "Groww MF order history (xlsx)",
    institution: "Groww",
    account_type: "investment",
    statement_kind: "mf_orders",
    file_kind: "xlsx",
    headers: ["Scheme Name", "Transaction Type", "Units", "NAV", "Amount", "Date"],
    data_start_offset: 1,
    column_map: { scheme_name: 0, side: 1, units: 2, nav: 3, amount: 4, order_date: 5 },
    amount_style: "signed_amount",
    narration_plugin: null,
    notes:
      "Groww → Reports → Mutual Funds Order History. No ISIN/order no — dedup is content-based; the personal-details block at the top is skipped, never stored.",
  },
  {
    name: "Mutual fund order book (xlsx)",
    institution: "MF Order Book",
    account_type: "investment",
    statement_kind: "mf_orders",
    file_kind: "xlsx",
    headers: [
      "Order No",
      "Order Date",
      "Order Time",
      "Sett. Type",
      "Scheme ID",
      "ISIN",
      "Name of MF Scheme",
      "Folio No",
      "Buy/Sell",
      "No of Units",
      "Physical/Demat Units",
      "NAV",
      "Commission (Rs.)",
      "Total Amount (Rs.)",
    ],
    data_start_offset: 1,
    column_map: {
      order_no: 0,
      order_date: 1,
      isin: 5,
      scheme_name: 6,
      folio: 7,
      side: 8,
      units: 9,
      nav: 11,
      amount: 13,
    },
    amount_style: "signed_amount",
    narration_plugin: null,
    notes: "Broker mutual-fund order-book export (BSE StAR style).",
  },
];

export function ensureBuiltinPresets(db: Database): void {
  const insert = db.prepare(`
    INSERT INTO import_presets
      (name, institution, account_type, statement_kind, file_kind, header_row,
       data_start_row, column_map, amount_style, header_fingerprint,
       narration_plugin, is_builtin, notes)
    VALUES
      (@name, @institution, @account_type, @statement_kind, @file_kind, NULL,
       @data_start_row, @column_map, @amount_style, @header_fingerprint,
       @narration_plugin, 1, @notes)
    ON CONFLICT(name) DO NOTHING
  `);

  for (const p of BUILTINS) {
    insert.run({
      name: p.name,
      institution: p.institution,
      account_type: p.account_type,
      statement_kind: p.statement_kind,
      file_kind: p.file_kind,
      data_start_row: p.data_start_offset,
      column_map: JSON.stringify(p.column_map),
      amount_style: p.amount_style,
      header_fingerprint: headerFingerprint(p.headers),
      narration_plugin: p.narration_plugin,
      notes: p.notes,
    });
  }
}
