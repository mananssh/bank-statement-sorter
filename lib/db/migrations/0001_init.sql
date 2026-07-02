-- Core schema. Conventions:
--   money            INTEGER minor units (paise for INR)
--   dates            TEXT ISO 'YYYY-MM-DD'
--   timestamps       TEXT ISO UTC (datetime('now'))
--   booleans         INTEGER 0/1
-- All tables STRICT. Full account numbers are never stored — last 4 digits only.

CREATE TABLE financial_years (
  id INTEGER PRIMARY KEY,
  start_year INTEGER NOT NULL UNIQUE,            -- 2025 => FY 2025-26 (with April start)
  label TEXT NOT NULL UNIQUE,                    -- 'FY2025-26'
  is_current INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE import_presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  institution TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('bank','credit_card','investment','cash')),
  statement_kind TEXT NOT NULL DEFAULT 'bank' CHECK (statement_kind IN ('bank','credit_card','mf_orders')),
  file_kind TEXT NOT NULL CHECK (file_kind IN ('xlsx','xls','csv')),
  sheet_selector TEXT,
  header_row INTEGER,                            -- 1-based; NULL = headerless
  data_start_row INTEGER NOT NULL,
  column_map TEXT NOT NULL,                      -- JSON: canonical field -> source column index
  date_format TEXT NOT NULL DEFAULT 'auto',
  amount_style TEXT NOT NULL
    CHECK (amount_style IN ('debit_credit_columns','signed_amount','amount_with_drcr_flag')),
  header_fingerprint TEXT,                       -- sha256 of normalized header cells
  detect_hints TEXT,                             -- JSON: filename regex, cell probes
  decrypt_expected INTEGER NOT NULL DEFAULT 0,
  narration_plugin TEXT,                         -- narration parser plugin id, e.g. 'hdfc'
  is_builtin INTEGER NOT NULL DEFAULT 0,
  notes TEXT
) STRICT;
CREATE INDEX idx_presets_fingerprint ON import_presets(header_fingerprint);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('bank','credit_card','investment','cash')),
  institution TEXT NOT NULL DEFAULT '',
  number_last4 TEXT,
  holder_name TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  default_preset_id INTEGER REFERENCES import_presets(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  meta TEXT NOT NULL DEFAULT '{}',               -- JSON; credit cards: billing_day, due_day, credit_limit_paise
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE account_fy_openings (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fy_start_year INTEGER NOT NULL,
  opening_balance_paise INTEGER NOT NULL,
  PRIMARY KEY (account_id, fy_start_year)
) STRICT;

-- Two-entity taxonomy: Category = ledger bucket ("Account" in Zoho Books),
-- Party = actual counterparty ("Party" in Zoho Books).
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('income','expense','investment','transfer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE parties (
  id INTEGER PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE party_aliases (
  id INTEGER PRIMARY KEY,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL UNIQUE                  -- normalized payee key or VPA
) STRICT;
CREATE INDEX idx_party_aliases_party ON party_aliases(party_id);

CREATE TABLE statements (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  preset_id INTEGER REFERENCES import_presets(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  archived_path TEXT,
  file_sha256 TEXT NOT NULL UNIQUE,              -- whole-file dedup
  file_kind TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  meta TEXT NOT NULL DEFAULT '{}',               -- JSON; CC: statement_date, due_date, total_due_paise, ...
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','partial','failed')),
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE categorization_rules (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  field TEXT NOT NULL CHECK (field IN ('narration','counterparty','vpa','ref_number','channel')),
  match_type TEXT NOT NULL CHECK (match_type IN ('exact','contains','prefix','regex')),
  pattern TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,  -- NULL = all accounts
  direction TEXT CHECK (direction IN ('debit','credit')),        -- NULL = both
  amount_min_paise INTEGER,
  amount_max_paise INTEGER,
  priority INTEGER NOT NULL DEFAULT 100,         -- lower wins
  is_active INTEGER NOT NULL DEFAULT 1,
  auto_created INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (field, match_type, pattern, account_id, direction)
) STRICT;

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  statement_id INTEGER REFERENCES statements(id) ON DELETE SET NULL,
  txn_date TEXT NOT NULL,
  narration TEXT NOT NULL,
  ref_number TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  balance_paise INTEGER,                         -- NULL for credit cards
  channel TEXT CHECK (channel IN ('upi','neft','imps','rtgs','pos','tpt','ach','atm',
    'cheque','interest','fee','emi','fd','other')),
  counterparty_raw TEXT,
  counterparty_vpa TEXT,
  upi_rrn TEXT,
  upi_note TEXT,
  parsed TEXT NOT NULL DEFAULT '{}',             -- JSON extras: ifsc, neucoins, cc txn type...
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  description TEXT,
  categorized_by TEXT CHECK (categorized_by IN ('memory','party_default','rule','manual')),
  rule_id INTEGER REFERENCES categorization_rules(id) ON DELETE SET NULL,
  is_transfer INTEGER NOT NULL DEFAULT 0,
  dedup_hash TEXT NOT NULL,
  dupe_seq INTEGER NOT NULL DEFAULT 0,
  month TEXT GENERATED ALWAYS AS (substr(txn_date, 1, 7)) STORED,
  fy_start_year INTEGER NOT NULL,                -- computed at insert from settings.fy_start_month
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, dedup_hash, dupe_seq)
) STRICT;
CREATE INDEX idx_txn_account_date ON transactions(account_id, txn_date);
CREATE INDEX idx_txn_category ON transactions(category_id);
CREATE INDEX idx_txn_party ON transactions(party_id);
CREATE INDEX idx_txn_fy_month ON transactions(fy_start_year, month);
CREATE INDEX idx_txn_vpa ON transactions(counterparty_vpa) WHERE counterparty_vpa IS NOT NULL;
CREATE INDEX idx_txn_uncat ON transactions(account_id, txn_date) WHERE category_id IS NULL;

CREATE TABLE narration_memory (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,                             -- normalized payee key or VPA
  account_id INTEGER NOT NULL DEFAULT 0,         -- 0 = all accounts
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  last_confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (key, account_id)
) STRICT;

CREATE TABLE transfer_links (
  id INTEGER PRIMARY KEY,
  txn_a INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  txn_b INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('amount_date','cc_bill_pattern','manual')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (txn_a, txn_b)
) STRICT;

-- Import wizard staging (survives refresh; committed transactionally; stale batches GC'd).
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  preset_id INTEGER REFERENCES import_presets(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  sheet_name TEXT,
  statement_kind TEXT NOT NULL DEFAULT 'bank',
  status TEXT NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging','reviewed','committed','discarded')),
  meta TEXT NOT NULL DEFAULT '{}',
  warnings TEXT NOT NULL DEFAULT '[]',           -- JSON array: balance gaps etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE import_rows (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  txn_date TEXT,
  narration TEXT,
  ref_number TEXT,
  direction TEXT,
  amount_paise INTEGER,
  balance_paise INTEGER,
  channel TEXT,
  counterparty_raw TEXT,
  counterparty_vpa TEXT,
  upi_rrn TEXT,
  upi_note TEXT,
  parsed TEXT NOT NULL DEFAULT '{}',
  suggested_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  suggested_party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  suggestion_source TEXT,                        -- 'memory' | 'party_default' | 'rule' | 'seed'
  suggestion_confidence REAL NOT NULL DEFAULT 0,
  user_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  user_party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  description TEXT,
  dedup_hash TEXT,
  dupe_seq INTEGER NOT NULL DEFAULT 0,
  dup_status TEXT NOT NULL DEFAULT 'new'
    CHECK (dup_status IN ('new','duplicate','possible_duplicate')),
  include INTEGER NOT NULL DEFAULT 1,
  parse_error TEXT
) STRICT;
CREATE INDEX idx_import_rows_batch ON import_rows(batch_id);

CREATE TABLE import_errors (
  id INTEGER PRIMARY KEY,
  statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  raw TEXT NOT NULL,                             -- JSON of raw cells; stays inside the DB trust boundary
  error TEXT NOT NULL
) STRICT;

-- Investments -----------------------------------------------------------------

CREATE TABLE funds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  asset_class TEXT NOT NULL DEFAULT 'equity'
    CHECK (asset_class IN ('equity','debt','gold','elss','hybrid','other')),
  sub_category TEXT,
  is_elss INTEGER NOT NULL DEFAULT 0,
  platform TEXT,
  isin TEXT,
  folio TEXT,
  is_sip_active INTEGER NOT NULL DEFAULT 0,
  notes TEXT
) STRICT;

CREATE TABLE investment_txns (
  id INTEGER PRIMARY KEY,
  fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  txn_date TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('sip','lumpsum','sell','dividend')),
  amount_paise INTEGER NOT NULL,
  nav REAL,
  units REAL,
  linked_txn_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  statement_id INTEGER REFERENCES statements(id) ON DELETE SET NULL,
  order_no TEXT UNIQUE,                          -- natural dedup key from broker order books
  fy_start_year INTEGER NOT NULL,
  notes TEXT
) STRICT;
CREATE INDEX idx_inv_txn_fund ON investment_txns(fund_id, txn_date);

CREATE TABLE fund_navs (
  fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  nav_date TEXT NOT NULL,
  nav REAL NOT NULL,
  PRIMARY KEY (fund_id, nav_date)
) STRICT;

CREATE VIEW holdings AS
  SELECT f.id AS fund_id, f.name, f.asset_class, f.sub_category, f.is_elss,
         SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN t.units ELSE -t.units END) AS units,
         SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN t.amount_paise ELSE -t.amount_paise END) AS cost_basis_paise,
         (SELECT n.nav FROM fund_navs n WHERE n.fund_id = f.id ORDER BY n.nav_date DESC LIMIT 1) AS last_nav,
         MAX(t.txn_date) AS last_txn_date
  FROM funds f JOIN investment_txns t ON t.fund_id = f.id
  GROUP BY f.id
  HAVING units > 0.0001;

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  allocation_pct REAL NOT NULL CHECK (allocation_pct >= 0 AND allocation_pct <= 100),
  notes TEXT
) STRICT;

CREATE TABLE fixed_deposits (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  fd_number TEXT NOT NULL UNIQUE,
  principal_paise INTEGER NOT NULL,
  interest_rate_bp INTEGER NOT NULL,             -- 625 = 6.25% p.a.
  start_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL,
  maturity_amount_paise INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','matured','closed')),
  notes TEXT
) STRICT;

-- Invoices --------------------------------------------------------------------

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  amount_minor INTEGER NOT NULL,                 -- in invoice currency minor units
  conversion_rate REAL NOT NULL DEFAULT 1,
  amount_inr_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','paid','void')),
  paid_txn_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  file_path TEXT,
  notes TEXT
) STRICT;

-- Settings --------------------------------------------------------------------

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                           -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

INSERT INTO settings (key, value) VALUES
  ('fy_start_month', '4'),
  ('currency', '"INR"');
