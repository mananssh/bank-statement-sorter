-- A "Fund of Fund" (FoF) is a mutual fund scheme that invests in units of
-- another fund (often an ETF) — it is folio-based, NAV-priced, and never
-- itself trades on an exchange, so it can never legitimately be classified
-- as an ETF. Broker exports carry "ETF" in the FoF's own name (e.g. "HDFC
-- Gold ETF Fund of Fund"), which misled the review screen's ETF/MF guess at
-- initial import, before CAS-based self-healing existed. Correct it directly
-- rather than waiting for a CAS re-import to notice.
UPDATE funds SET instrument_kind = 'mutual_fund'
WHERE instrument_kind = 'etf' AND lower(name) LIKE '%fund of fund%';
