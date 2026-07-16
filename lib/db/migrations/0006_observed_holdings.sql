-- Observed (statement-backed) holdings without synthetic transactions.
--
-- e-CAS imports previously fabricated a "buy" at statement market value so
-- demat stocks would appear in the holdings view. That polluted the ledger
-- with transactions that never happened. Instead, instrument_valuations
-- learns an optional units column (the observed position size), and the
-- holdings view stops requiring transactions: an instrument appears if it
-- has transaction-derived units OR a recorded valuation. Cost basis / P&L /
-- XIRR stay null for observation-only holdings — no data is invented.

ALTER TABLE instrument_valuations ADD COLUMN units REAL;

-- Remove previously fabricated e-CAS opening positions (app-generated rows,
-- identifiable by our own order_no prefix — never user-entered data).
DELETE FROM investment_txns WHERE order_no LIKE 'NSDL-CAS-OPEN:%';

DROP VIEW holdings;
CREATE VIEW holdings AS
  SELECT f.id AS fund_id, f.name, f.asset_class, f.sub_category, f.is_elss,
         f.instrument_kind, f.symbol, f.is_sip_active, f.sip_weight, f.sip_amount_paise,
         COUNT(t.id) AS txn_count,
         COALESCE(SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN COALESCE(t.units, 0)
                           WHEN t.txn_type = 'sell' THEN -COALESCE(t.units, 0)
                           ELSE 0 END), 0) AS units,
         COALESCE(SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN t.amount_paise
                           WHEN t.txn_type = 'sell' THEN -t.amount_paise
                           ELSE 0 END), 0) AS cost_basis_paise,
         (SELECT n.nav FROM fund_navs n WHERE n.fund_id = f.id
          ORDER BY n.nav_date DESC LIMIT 1) AS last_nav,
         (SELECT n.nav_date FROM fund_navs n WHERE n.fund_id = f.id
          ORDER BY n.nav_date DESC LIMIT 1) AS last_nav_date,
         (SELECT v.value_paise FROM instrument_valuations v WHERE v.fund_id = f.id
          ORDER BY v.val_date DESC LIMIT 1) AS last_valuation_paise,
         (SELECT v.val_date FROM instrument_valuations v WHERE v.fund_id = f.id
          ORDER BY v.val_date DESC LIMIT 1) AS last_valuation_date,
         (SELECT v.units FROM instrument_valuations v WHERE v.fund_id = f.id
          ORDER BY v.val_date DESC LIMIT 1) AS last_valuation_units,
         MAX(t.txn_date) AS last_txn_date
  FROM funds f LEFT JOIN investment_txns t ON t.fund_id = f.id
  GROUP BY f.id
  HAVING units > 0.0001 OR cost_basis_paise > 0 OR last_valuation_paise IS NOT NULL;
