import "server-only";
import type { Database } from "better-sqlite3";
import type { AssetClass, InstrumentKind } from "@/lib/db/types";

/**
 * Instrument identity for broker imports. Matching order: learned alias →
 * ISIN → exact normalized name → unambiguous prefix/containment. Anything
 * else is left for the user to map in the review step, and the confirmed
 * mapping is stored as an alias so it never asks twice.
 */

export function normalizeSchemeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchFund(
  db: Database,
  schemeName: string,
  isin?: string | null,
): number | null {
  const key = normalizeSchemeName(schemeName);
  if (!key) return null;

  const byAlias = db
    .prepare(`SELECT fund_id FROM fund_aliases WHERE alias = ?`)
    .get(key) as { fund_id: number } | undefined;
  if (byAlias) return byAlias.fund_id;

  if (isin) {
    const byIsin = db.prepare(`SELECT id FROM funds WHERE isin = ?`).get(isin.trim()) as
      | { id: number }
      | undefined;
    if (byIsin) return byIsin.id;
  }

  const funds = db.prepare(`SELECT id, name FROM funds`).all() as Array<{
    id: number;
    name: string;
  }>;
  const exact = funds.filter((f) => normalizeSchemeName(f.name) === key);
  if (exact.length === 1) return exact[0].id;

  // Unambiguous containment either way ("HDFC Gold ETF FoF Direct" vs the
  // export's truncated "HDFC Gold ETF Fund of Fund Direct P...").
  const contains = funds.filter((f) => {
    const n = normalizeSchemeName(f.name);
    return n.startsWith(key) || key.startsWith(n) || n.includes(key) || key.includes(n);
  });
  return contains.length === 1 ? contains[0].id : null;
}

export function saveFundAlias(db: Database, fundId: number, schemeName: string): void {
  const key = normalizeSchemeName(schemeName);
  if (!key) return;
  db.prepare(
    `INSERT INTO fund_aliases (fund_id, alias) VALUES (?, ?)
     ON CONFLICT(alias) DO UPDATE SET fund_id = excluded.fund_id`,
  ).run(fundId, key);
}

export interface NewInstrumentInput {
  name: string;
  instrument_kind: InstrumentKind;
  asset_class: AssetClass;
  sub_category: string | null;
  is_elss: boolean;
  isin: string | null;
  platform: string | null;
  /** Recurring monthly SIP, tracked by the SIP tracker/planner. Default off
   *  — every instrument used to be created as an active SIP unconditionally,
   *  which is why the tracker showed everything; now it's a deliberate
   *  per-fund opt-in (toggle it after import, or pass true here). */
  is_sip_active?: boolean;
}

export function createInstrument(db: Database, input: NewInstrumentInput): number {
  const res = db
    .prepare(
      `INSERT INTO funds (name, asset_class, sub_category, is_elss, platform, isin,
                          is_sip_active, instrument_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.asset_class,
      input.sub_category?.trim() || null,
      input.is_elss ? 1 : 0,
      input.platform?.trim() || null,
      input.isin?.trim() || null,
      input.is_sip_active ? 1 : 0,
      input.instrument_kind,
    );
  return Number(res.lastInsertRowid);
}
