-- Investments generalization: beyond mutual funds.
--
-- funds grows into an "instruments" registry: MFs, stocks/ETFs (symbol), and
-- balance-based retirement instruments (PPF/EPF/NPS — no units; value comes
-- from instrument_valuations, contributions still land in investment_txns).
-- allocation_targets stores the target-builder tree (tier-1 asset classes +
-- sub-splits; sub_category '' means the tier-1 row for that class).

ALTER TABLE funds ADD COLUMN instrument_kind TEXT NOT NULL DEFAULT 'mutual_fund'
  CHECK (instrument_kind IN ('mutual_fund','stock','etf','ppf','epf','nps','bond','other'));
ALTER TABLE funds ADD COLUMN symbol TEXT;
ALTER TABLE funds ADD COLUMN sip_weight REAL NOT NULL DEFAULT 1
  CHECK (sip_weight >= 0);
ALTER TABLE funds ADD COLUMN sip_amount_paise INTEGER;

CREATE TABLE allocation_targets (
  id INTEGER PRIMARY KEY,
  asset_class TEXT NOT NULL
    CHECK (asset_class IN ('equity','debt','gold','elss','hybrid','other')),
  sub_category TEXT NOT NULL DEFAULT '',   -- '' = tier-1 row for the class
  target_pct REAL NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100),
  UNIQUE (asset_class, sub_category)
) STRICT;

-- Manual "current value" points — the valuation source for balance-based
-- instruments, and an override for anything unlisted. Latest date wins.
CREATE TABLE instrument_valuations (
  fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  val_date TEXT NOT NULL,
  value_paise INTEGER NOT NULL CHECK (value_paise >= 0),
  PRIMARY KEY (fund_id, val_date)
) STRICT;

-- holdings v2: expose the new instrument fields + latest valuation, and fix
-- dividend handling (payouts must not reduce units or cost basis).
DROP VIEW holdings;
CREATE VIEW holdings AS
  SELECT f.id AS fund_id, f.name, f.asset_class, f.sub_category, f.is_elss,
         f.instrument_kind, f.symbol, f.is_sip_active, f.sip_weight, f.sip_amount_paise,
         SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN COALESCE(t.units, 0)
                  WHEN t.txn_type = 'sell' THEN -COALESCE(t.units, 0)
                  ELSE 0 END) AS units,
         SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN t.amount_paise
                  WHEN t.txn_type = 'sell' THEN -t.amount_paise
                  ELSE 0 END) AS cost_basis_paise,
         (SELECT n.nav FROM fund_navs n WHERE n.fund_id = f.id
          ORDER BY n.nav_date DESC LIMIT 1) AS last_nav,
         (SELECT n.nav_date FROM fund_navs n WHERE n.fund_id = f.id
          ORDER BY n.nav_date DESC LIMIT 1) AS last_nav_date,
         (SELECT v.value_paise FROM instrument_valuations v WHERE v.fund_id = f.id
          ORDER BY v.val_date DESC LIMIT 1) AS last_valuation_paise,
         (SELECT v.val_date FROM instrument_valuations v WHERE v.fund_id = f.id
          ORDER BY v.val_date DESC LIMIT 1) AS last_valuation_date,
         MAX(t.txn_date) AS last_txn_date
  FROM funds f JOIN investment_txns t ON t.fund_id = f.id
  GROUP BY f.id
  HAVING units > 0.0001 OR cost_basis_paise > 0;
