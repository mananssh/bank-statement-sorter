import "server-only";
import { db } from "@/lib/db/client";
import { coerceDate } from "@/lib/normalize/dates";
import { getSetting, setSetting } from "@/lib/repos/settings";
import { logSafe } from "@/lib/security/redact";

/**
 * AMFI daily NAV fetch — THE ONLY external network call in the app, and it
 * only runs when the user has explicitly enabled it in Settings. One GET to
 * AMFI's public NAVAll.txt (no auth, no cookies, nothing sent but the request
 * itself); NAVs are matched to instruments and stored locally.
 *
 * Matching: ISIN when the fund has one; otherwise a strict all-tokens name
 * match that must be UNIQUE across AMFI's list — and on success the matched
 * ISIN is written back to the fund, so future fetches are exact.
 */

const AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

export interface AmfiFetchResult {
  updated: number;
  matched_by_name: number;
  unmatched: string[];
  nav_date: string | null;
}

interface AmfiRow {
  isins: string[];
  name: string;
  normName: string;
  nav: number;
  date: string;
}

export function amfiEnabled(): boolean {
  return getSetting<boolean>("amfi_enabled", false);
}

function normalize(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchAmfiNavs(): Promise<AmfiFetchResult> {
  if (!amfiEnabled()) {
    throw new Error("AMFI NAV fetch is disabled — enable it in Settings first.");
  }

  const res = await fetch(AMFI_URL, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
  const text = await res.text();

  const rows: AmfiRow[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(";");
    // Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;NAV;Date
    if (parts.length < 6) continue;
    const nav = Number(parts[4]);
    const date = coerceDate(parts[5].trim());
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue;
    const isins = [parts[1].trim(), parts[2].trim()].filter((i) => /^IN[A-Z0-9]{10}$/.test(i));
    const name = parts[3].trim();
    rows.push({ isins, name, normName: normalize(name), nav, date });
  }
  if (rows.length === 0) throw new Error("AMFI response did not parse — format may have changed.");

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
    let hit: AmfiRow | undefined;
    if (f.isin) hit = byIsin.get(f.isin.trim());

    if (!hit) {
      // Strict token containment, unique across the whole list.
      const tokens = normalize(f.name).split(" ").filter((t) => t.length > 1 || /\d/.test(t));
      if (tokens.length >= 2) {
        const candidates = rows.filter((r) => tokens.every((t) => r.normName.includes(t)));
        if (candidates.length === 1) {
          hit = candidates[0];
          matchedByName++;
          if (hit.isins[0]) setIsin.run(hit.isins[0], f.id); // self-heal to exact matching
        }
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
