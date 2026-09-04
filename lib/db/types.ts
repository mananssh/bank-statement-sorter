// Row types mirroring lib/db/migrations/0001_init.sql.

export type AccountType = "bank" | "credit_card" | "investment" | "cash";
export type CategoryType = "income" | "expense" | "investment" | "transfer";
export type Direction = "debit" | "credit";
export type Channel =
  | "upi" | "neft" | "imps" | "rtgs" | "pos" | "tpt" | "ach" | "atm"
  | "cheque" | "interest" | "fee" | "emi" | "fd" | "other";
export type StatementKind = "bank" | "credit_card" | "mf_orders";
export type AmountStyle = "debit_credit_columns" | "signed_amount" | "amount_with_drcr_flag";
export type CategorizedBy = "memory" | "party_default" | "rule" | "manual";
export type DupStatus = "new" | "duplicate" | "possible_duplicate";

export interface AccountRow {
  id: number;
  name: string;
  type: AccountType;
  institution: string;
  number_last4: string | null;
  holder_name: string | null;
  currency: string;
  default_preset_id: number | null;
  is_active: number;
  meta: string;
  created_at: string;
}

export interface CategoryRow {
  id: number;
  name: string;
  type: CategoryType;
  is_active: number;
  notes: string | null;
  sort_order: number;
  requires_bill_period: number;
}

export interface BillCoverageRow {
  id: number;
  txn_id: number;
  cc_account_id: number;
  period_from: string;
  period_to: string;
  allocated_paise: number;
  created_at: string;
}

export interface PartyRow {
  id: number;
  canonical_name: string;
  default_category_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface ImportPresetRow {
  id: number;
  name: string;
  institution: string;
  account_type: AccountType;
  statement_kind: StatementKind;
  file_kind: "xlsx" | "xls" | "csv";
  sheet_selector: string | null;
  header_row: number | null;
  data_start_row: number;
  column_map: string;
  date_format: string;
  amount_style: AmountStyle;
  header_fingerprint: string | null;
  detect_hints: string | null;
  decrypt_expected: number;
  narration_plugin: string | null;
  is_builtin: number;
  notes: string | null;
}

export interface StatementRow {
  id: number;
  account_id: number;
  preset_id: number | null;
  file_name: string;
  archived_path: string | null;
  file_sha256: string;
  file_kind: string;
  period_start: string | null;
  period_end: string | null;
  meta: string;
  status: "imported" | "partial" | "failed";
  rows_total: number;
  rows_imported: number;
  rows_duplicate: number;
  imported_at: string;
}

export interface TransactionRow {
  id: number;
  account_id: number;
  statement_id: number | null;
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
  parsed: string;
  category_id: number | null;
  party_id: number | null;
  description: string | null;
  categorized_by: CategorizedBy | null;
  rule_id: number | null;
  is_transfer: number;
  dedup_hash: string;
  dupe_seq: number;
  month: string;
  fy_start_year: number;
  created_at: string;
}

export interface RuleRow {
  id: number;
  category_id: number;
  party_id: number | null;
  field: "narration" | "counterparty" | "vpa" | "ref_number" | "channel";
  match_type: "exact" | "contains" | "prefix" | "regex";
  pattern: string;
  account_id: number | null;
  direction: Direction | null;
  amount_min_paise: number | null;
  amount_max_paise: number | null;
  priority: number;
  is_active: number;
  auto_created: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
}

export interface NarrationMemoryRow {
  id: number;
  key: string;
  account_id: number;
  category_id: number;
  party_id: number | null;
  hit_count: number;
  last_confirmed_at: string;
}

export interface ImportBatchRow {
  id: number;
  account_id: number | null;
  preset_id: number | null;
  file_name: string;
  file_sha256: string;
  file_kind: string;
  sheet_name: string | null;
  statement_kind: StatementKind;
  status: "staging" | "reviewed" | "committed" | "discarded";
  meta: string;
  warnings: string;
  created_at: string;
}

export interface ImportRowRow {
  id: number;
  batch_id: number;
  row_no: number;
  txn_date: string | null;
  narration: string | null;
  ref_number: string | null;
  direction: Direction | null;
  amount_paise: number | null;
  balance_paise: number | null;
  channel: Channel | null;
  counterparty_raw: string | null;
  counterparty_vpa: string | null;
  upi_rrn: string | null;
  upi_note: string | null;
  parsed: string;
  suggested_category_id: number | null;
  suggested_party_id: number | null;
  suggestion_source: string | null;
  suggestion_confidence: number;
  user_category_id: number | null;
  user_party_id: number | null;
  description: string | null;
  dedup_hash: string | null;
  dupe_seq: number;
  dup_status: DupStatus;
  include: number;
  parse_error: string | null;
}

export type AssetClass = "equity" | "debt" | "gold" | "elss" | "hybrid" | "other";
export type InstrumentKind =
  | "mutual_fund" | "stock" | "etf" | "ppf" | "epf" | "nps" | "bond" | "other";

/** Kinds valued by a balance you type in, not units × NAV. */
export const BALANCE_KINDS: InstrumentKind[] = ["ppf", "epf", "nps"];

export interface FundRow {
  id: number;
  name: string;
  asset_class: AssetClass;
  sub_category: string | null;
  is_elss: number;
  platform: string | null;
  isin: string | null;
  folio: string | null;
  is_sip_active: number;
  notes: string | null;
  instrument_kind: InstrumentKind;
  symbol: string | null;
  sip_weight: number;
  sip_amount_paise: number | null;
  is_hidden: number;
}

export interface AllocationTargetRow {
  id: number;
  asset_class: AssetClass;
  sub_category: string; // '' = tier-1 row
  target_pct: number;
}

export interface InvestmentTxnRow {
  id: number;
  fund_id: number;
  txn_date: string;
  txn_type: "sip" | "lumpsum" | "sell" | "dividend";
  amount_paise: number;
  nav: number | null;
  units: number | null;
  linked_txn_id: number | null;
  statement_id: number | null;
  order_no: string | null;
  fy_start_year: number;
  notes: string | null;
}

export interface HoldingRow {
  fund_id: number;
  name: string;
  asset_class: string;
  sub_category: string | null;
  is_elss: number;
  instrument_kind: InstrumentKind;
  symbol: string | null;
  is_sip_active: number;
  sip_weight: number;
  sip_amount_paise: number | null;
  is_hidden: number;
  txn_count: number;
  units: number;
  cost_basis_paise: number;
  last_nav: number | null;
  last_nav_date: string | null;
  last_valuation_paise: number | null;
  last_valuation_date: string | null;
  last_valuation_units: number | null;
  last_txn_date: string;
}

export interface FixedDepositRow {
  id: number;
  account_id: number | null;
  fd_number: string;
  principal_paise: number;
  interest_rate_bp: number;
  start_date: string;
  maturity_date: string;
  maturity_amount_paise: number | null;
  status: "active" | "matured" | "closed";
  notes: string | null;
}

export interface InvoiceRow {
  id: number;
  invoice_no: string;
  client: string;
  issue_date: string;
  currency: string;
  amount_minor: number;
  conversion_rate: number;
  amount_inr_paise: number;
  status: "draft" | "sent" | "paid" | "void";
  paid_txn_id: number | null;
  file_path: string | null;
  notes: string | null;
}

export interface GoalRow {
  id: number;
  name: string;
  /** ISO date; purchases before it are not attributed to this goal. */
  start_date: string;
  /** Share of the units of every SIP purchase made on or after start_date. */
  sip_share_pct: number;
  is_archived: number;
  notes: string | null;
}
