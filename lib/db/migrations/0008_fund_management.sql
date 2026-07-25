-- Per-instrument management: hiding clutter (e.g. family/legacy demat
-- holdings someone doesn't consider part of their own portfolio) and making
-- SIP tracking a deliberate opt-in rather than the default for everything.
--
-- is_sip_active was being forced to 1 for every instrument regardless of
-- source (a bug in createInstrument's INSERT, fixed alongside this
-- migration) — so the SIP tracker showed every fund ever imported, not just
-- active recurring SIPs. Reset it to 0 so it becomes an explicit per-fund
-- choice made via the inline control on the Investments page.
ALTER TABLE funds ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1));
UPDATE funds SET is_sip_active = 0;

DROP VIEW holdings;
CREATE VIEW holdings AS
  SELECT f.id AS fund_id, f.name, f.asset_class, f.sub_category, f.is_elss,
         f.instrument_kind, f.symbol, f.is_sip_active, f.sip_weight, f.sip_amount_paise,
         f.is_hidden,
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
