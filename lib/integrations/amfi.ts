import "server-only";
import { db } from "@/lib/db/client";
import { coerceDate } from "@/lib/normalize/dates";
import { getSetting, setSetting } from "@/lib/repos/settings";
import { logSafe } from "@/lib/security/redact";
import { matchAmfiByName, parseNavAll, type AmfiRow } from "@/lib/integrations/amfi-match";

/**
 * AMFI daily NAV fetch — THE ONLY external network call in the app, and it
 * only runs when the user has explicitly enabled it in Settings. One GET to
 * AMFI's public NAVAll.txt (no auth, no cookies, nothing sent but the request
 * itself); NAVs are matched to instruments and stored locally.
 *
 * Matching: ISIN when the fund has one; otherwise the plan/option-aware name
 * matcher in amfi-match.ts — and on success the matched ISIN is written back
 * to the fund, so future fetches are exact.
 */

// www.amfiindia.com/spages/NAVAll.txt 302s here; hit the target directly so
// the opt-in fetch stays one request to one host.
const AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

export interface AmfiFetchResult {
  updated: number;
  matched_by_name: number;
  unmatched: string[];
  nav_date: string | null;
}

export function amfiEnabled(): boolean {
  return getSetting<boolean>("amfi_enabled", false);
}

export async function fetchAmfiNavs(): Promise<AmfiFetchResult> {
  if (!amfiEnabled()) {
    throw new Error("AMFI NAV fetch is disabled — enable it in Settings first.");
  }

  const res = await fetch(AMFI_URL, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
  const text = await res.text();
  const rows = parseNavAll(text, coerceDate);
  if (rows.length === 0) {
    // Name the header we got: the last break was a column-layout change, and
    // this is public market data, so it is safe (and much faster) to show it.
    const header = text.split("\n", 1)[0].slice(0, 200).trim();
    throw new Error(
      `AMFI response did not parse — format may have changed. First line: ${header || "(empty)"}`,
    );
  }

  const byIsin = new Map<string, AmfiRow>();
  for (const r of rows) for (const i of r.isins) byIsin.set(i, r);

  const conn = db();
  const funds = conn
    .prepare(`SELECT id, name, isin FROM funds WHERE instrument_kind IN ('mutual_fund','etf')`)
    .all() as Array<{ id: number; name: string; isin: string | null }>;

  const upsertNav = conn.prepare(
    `INSERT INTO fund_navs (fund_id, nav_date, nav) VALUES (?, ?, ?)
     ON CONFLICT(fund_id, nav_date) DO UPDATE SET nav = excluded.nav`,
  );
  const setIsin = conn.prepare(`UPDATE funds SET isin = ? WHERE id = ?`);

  let updated = 0;
  let matchedByName = 0;
  const unmatched: string[] = [];
  let navDate: string | null = null;

  for (const f of funds) {
    let hit: AmfiRow | undefined | null;
    if (f.isin) hit = byIsin.get(f.isin.trim());

    if (!hit) {
      hit = matchAmfiByName(f.name, rows);
      if (hit) {
        matchedByName++;
        if (hit.isins[0]) setIsin.run(hit.isins[0], f.id); // self-heal to exact matching
      }
    }

    if (hit) {
      upsertNav.run(f.id, hit.date, hit.nav);
      updated++;
      if (!navDate || hit.date > navDate) navDate = hit.date;
    } else {
      unmatched.push(f.name);
    }
  }

  setSetting("amfi_last_fetch", new Date().toISOString());
  logSafe("amfi", `NAV fetch: ${updated} updated, ${unmatched.length} unmatched`);
  return { updated, matched_by_name: matchedByName, unmatched, nav_date: navDate };
}
