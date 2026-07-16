import "server-only";
import type { Statement } from "better-sqlite3";
import { db } from "@/lib/db/client";
import { fyStartYear } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";
import { createInstrument, matchFund, saveFundAlias } from "@/lib/import/instruments";
import type { CamsCas, CamsScheme, CamsTxn } from "@/lib/parsers/cas/cams";
import type { NsdlCas } from "@/lib/parsers/cas/nsdl";
import type { AssetClass, InstrumentKind } from "@/lib/db/types";

/**
 * CAS → DB ingestion. CAMS detailed CAS is the authoritative source for MF
 * transactions; NSDL/CDSL e-CAS is the source for demat (stock/ETF) positions
 * and a units cross-check for MF folios.
 *
 * Dedup is content-based (fund + date + units, falling back to amount within
 * ₹2) because CAS rows carry no order number — this both makes re-imports
 * no-ops and avoids double-counting orders already imported from a broker
 * export (whose amounts can differ from CAS by the stamp-duty paise).
 *
 * NSDL equities with no transaction history get a synthetic opening position
 * at the statement's market value (cost basis = value at first sight, marked
 * in notes) — CAS shows quantities, not the prices originally paid. MF rows
 * never get synthetic positions: the CAMS detailed CAS backfills real ones.
 */

function guessAssetClass(name: string): { asset_class: AssetClass; is_elss: boolean } {
  const n = name.toLowerCase();
  if (/elss|tax ?saver/.test(n)) return { asset_class: "elss", is_elss: true };
  if (/gold|silver/.test(n)) return { asset_class: "gold", is_elss: false };
  if (
    /liquid|overnight|debt|gilt|bond|corporate|credit risk|duration|money market|ultra short|floater|treasury/.test(
      n,
    )
  ) {
    return { asset_class: "debt", is_elss: false };
  }
  if (/hybrid|balanced|multi.?asset|arbitrage|equity savings/.test(n)) {
    return { asset_class: "hybrid", is_elss: false };
  }
  return { asset_class: "equity", is_elss: false };
}

function resolveOrCreate(
  name: string,
  isin: string | null,
  kind: InstrumentKind,
  platform: string,
): { fundId: number; created: boolean } {
  const conn = db();
  const existing = matchFund(conn, name, isin);
  if (existing !== null) {
    saveFundAlias(conn, existing, name);
    if (isin) {
      conn
        .prepare(`UPDATE funds SET isin = ? WHERE id = ? AND isin IS NULL`)
        .run(isin, existing);
    }
    return { fundId: existing, created: false };
  }
  const guess = guessAssetClass(name);
  const fundId = createInstrument(conn, {
    name,
    instrument_kind: kind,
    asset_class: kind === "stock" ? "equity" : guess.asset_class,
    sub_category: null,
    is_elss: guess.is_elss,
    isin,
    platform,
  });
  saveFundAlias(conn, fundId, name);
  return { fundId, created: true };
}

const upsertNavStmt = () =>
  db().prepare(
    `INSERT INTO fund_navs (fund_id, nav_date, nav) VALUES (?, ?, ?)
     ON CONFLICT(fund_id, nav_date) DO UPDATE SET nav = excluded.nav`,
  );

// ---------------------------------------------------------------------------
// CAMS detailed CAS → investment_txns
// ---------------------------------------------------------------------------

export interface CamsImportResult {
  schemes: number;
  instruments_created: number;
  inserted: number;
  skipped_duplicates: number;
  charges_skipped: number;
  unparsed_schemes: string[];
  /** Schemes whose CAS opening balance has units the app has no history for —
   *  the statement starts mid-life; a since-inception CAS backfills them. */
  missing_history: Array<{ name: string; opening_units: number }>;
}

interface ExistingTxn {
  id: number;
  txn_date: string;
  amount_paise: number;
  units: number | null;
  consumed?: boolean;
}

function isDuplicate(existing: ExistingTxn[], t: CamsTxn): boolean {
  for (const e of existing) {
    if (e.consumed || e.txn_date !== t.date) continue;
    const unitsMatch =
      t.units !== null && e.units !== null
        ? Math.abs(Math.abs(e.units) - Math.abs(t.units)) < 0.005
        : null;
    const amountClose =
      Math.abs(Math.abs(e.amount_paise) - Math.abs(t.amount_paise)) <= 200; // ₹2 (stamp-duty drift)
    if (unitsMatch === true || (unitsMatch === null && amountClose)) {
      e.consumed = true;
      return true;
    }
    if (unitsMatch === false && amountClose && t.units === null) {
      e.consumed = true;
      return true;
    }
  }
  return false;
}

export function importCamsCas(cas: CamsCas): CamsImportResult {
  const conn = db();
  const startMonth = fyStartMonth();
  const insert = conn.prepare(
    `INSERT INTO investment_txns
       (fund_id, txn_date, txn_type, amount_paise, nav, units, fy_start_year, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertNav = upsertNavStmt();

  const result: CamsImportResult = {
    schemes: cas.schemes.length,
    instruments_created: 0,
    inserted: 0,
    skipped_duplicates: 0,
    charges_skipped: 0,
    unparsed_schemes: [],
    missing_history: [],
  };

  const run = conn.transaction(() => {
    for (const scheme of cas.schemes) {
      if (!scheme.name) {
        result.unparsed_schemes.push(scheme.isin ?? "(unnamed scheme)");
        continue;
      }
      const { fundId, created } = resolveOrCreate(
        scheme.name,
        scheme.isin,
        "mutual_fund",
        "CAS",
      );
      if (created) result.instruments_created++;
      result.charges_skipped += scheme.charges_skipped;

      const existing = conn
        .prepare(
          `SELECT id, txn_date, amount_paise, units FROM investment_txns WHERE fund_id = ?`,
        )
        .all(fundId) as ExistingTxn[];

      if (existing.length === 0 && (scheme.opening_units ?? 0) > 0.005) {
        result.missing_history.push({
          name: scheme.name,
          opening_units: scheme.opening_units!,
        });
      }

      for (const t of scheme.txns) {
        if (isDuplicate(existing, t)) {
          result.skipped_duplicates++;
          continue;
        }
        result.inserted += insertCamsTxn(insert, fundId, t, startMonth);
        if (t.nav !== null && t.nav > 0) upsertNav.run(fundId, t.date, t.nav);
      }

      if (scheme.closing_nav !== null && scheme.closing_nav_date) {
        upsertNav.run(fundId, scheme.closing_nav_date, scheme.closing_nav);
      }
    }
  });
  run();
  return result;
}

function insertCamsTxn(
  insert: Statement<unknown[]>,
  fundId: number,
  t: CamsTxn,
  startMonth: number,
): number {
  const fy = fyStartYear(t.date, startMonth);
  const abs = Math.abs(t.amount_paise);
  const units = t.units !== null ? Math.abs(t.units) : null;
  const note = `CAMS CAS: ${t.description}`;

  if (t.type === "dividend_reinvest") {
    // Net external flow is zero: record the payout and its reinvestment so
    // XIRR cancels the cash while units and cost basis grow correctly.
    insert.run(fundId, t.date, "dividend", abs, null, null, fy, note);
    insert.run(fundId, t.date, "lumpsum", abs, t.nav, units, fy, note);
    return 2;
  }
  const type =
    t.type === "sip" || t.type === "lumpsum" || t.type === "sell" || t.type === "dividend"
      ? t.type
      : "lumpsum";
  insert.run(fundId, t.date, type, abs, t.nav, type === "dividend" ? null : units, fy, note);
  return 1;
}

// ---------------------------------------------------------------------------
// NSDL/CDSL e-CAS → demat positions, NAV points, units reconciliation
// ---------------------------------------------------------------------------

export interface NsdlReconcileRow {
  isin: string;
  name: string;
  cas_units: number;
  app_units: number;
}

export interface NsdlImportResult {
  holdings: number;
  instruments_created: number;
  opening_positions: number;
  navs_updated: number;
  mismatches: NsdlReconcileRow[]; // app units ≠ CAS units (needs a look)
  mf_without_txns: string[]; // import CAMS detailed CAS to backfill these
}

export function importNsdlCas(cas: NsdlCas): NsdlImportResult {
  const conn = db();
  const startMonth = fyStartMonth();
  const navDate = cas.statement_date;
  const upsertNav = upsertNavStmt();
  const insert = conn.prepare(
    `INSERT INTO investment_txns
       (fund_id, txn_date, txn_type, amount_paise, nav, units, fy_start_year, order_no, notes)
     VALUES (?, ?, 'lumpsum', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_no) DO NOTHING`,
  );

  const result: NsdlImportResult = {
    holdings: cas.holdings.length,
    instruments_created: 0,
    opening_positions: 0,
    navs_updated: 0,
    mismatches: [],
    mf_without_txns: [],
  };

  const run = conn.transaction(() => {
    for (const h of cas.holdings) {
      if (!h.name && h.units === null) continue;
      const kind: InstrumentKind =
        h.kind === "equity" ? "stock" : /\bETF\b|BEES\b/i.test(h.name) ? "etf" : "mutual_fund";
      const { fundId, created } = resolveOrCreate(h.name || h.isin, h.isin, kind, "CAS");
      if (created) result.instruments_created++;

      if (h.price !== null && h.price > 0 && navDate) {
        upsertNav.run(fundId, navDate, h.price);
        result.navs_updated++;
      }

      const agg = conn
        .prepare(
          `SELECT COUNT(*) AS n,
                  COALESCE(SUM(CASE WHEN txn_type IN ('sip','lumpsum') THEN COALESCE(units,0)
                                    WHEN txn_type = 'sell' THEN -COALESCE(units,0)
                                    ELSE 0 END), 0) AS units
           FROM investment_txns WHERE fund_id = ?`,
        )
        .get(fundId) as { n: number; units: number };

      if (agg.n === 0) {
        // Equities AND ETFs: both live in demat, and the CAMS detailed CAS
        // (which backfills real MF txns) never covers either of them.
        const openable = h.kind === "equity" || kind === "etf";
        if (openable && h.units !== null && h.value_paise !== null && navDate) {
          // Synthetic opening position at statement market value; order_no
          // keyed on ISIN alone so later statements can't re-open it.
          insert.run(
            fundId,
            navDate,
            h.value_paise,
            h.price,
            h.units,
            fyStartYear(navDate, startMonth),
            `NSDL-CAS-OPEN:${h.isin}`,
            `Opening position from e-CAS as on ${navDate} (cost basis = market value at import)`,
          );
          result.opening_positions++;
        } else if (h.kind === "fund") {
          result.mf_without_txns.push(h.name || h.isin);
        }
        continue;
      }

      if (h.units !== null && Math.abs(agg.units - h.units) > 0.01) {
        result.mismatches.push({
          isin: h.isin,
          name: h.name || h.isin,
          cas_units: h.units,
          app_units: agg.units,
        });
      }
    }
  });
  run();
  return result;
}
