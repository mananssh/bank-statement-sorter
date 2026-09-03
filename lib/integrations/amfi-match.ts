/**
 * Pure AMFI NAVAll.txt parsing + scheme-name matching. No DB, no network —
 * kept separate from the fetcher so it can be exercised offline by
 * scripts/dev-amfi-check.ts against a saved NAVAll.txt.
 *
 * Matching problem: broker names ("HDFC NIFTY 50 Index Fund Direct Growth")
 * rarely equal AMFI's official names ("HDFC Nifty 50 Index Fund - Direct
 * Plan"), which spell the plan/option inconsistently per AMC — sometimes
 * "Direct Plan - Growth Option", sometimes just "Direct Plan". So:
 *
 *  1. Split names into CORE tokens (fund identity) vs qualifiers
 *     (Direct/Regular plan, Growth/IDCW/Bonus option, "Plan"/"Option" filler).
 *  2. A candidate must contain every core token as a whole word — word-level,
 *     never substring, so "50" ≠ "250" and "Nifty" ≠ "Nifty50".
 *  3. Reject rows of the wrong plan/option (Regular when we want Direct,
 *     IDCW/Bonus when we want growth — growth is the default).
 *  4. Prefer fewest extra core tokens (so "Midcap Fund" beats "Large and
 *     Midcap Fund"), then explicit plan/option words. The best row must be
 *     strictly better than the runner-up, else no match — never guess.
 */

export interface AmfiRow {
  isins: string[];
  name: string;
  tokens: string[];
  nav: number;
  date: string;
}

const PLAN_WORDS = new Set(["DIRECT", "REGULAR"]);
const PAYOUT_WORDS = new Set(["IDCW", "DIVIDEND", "BONUS", "PAYOUT", "REINVESTMENT", "REINVEST"]);
const FILLER_WORDS = new Set(["PLAN", "OPTION", "OPT"]);

export function tokenize(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function coreTokens(tokens: string[]): string[] {
  return tokens.filter(
    (t) => t !== "GROWTH" && !PLAN_WORDS.has(t) && !PAYOUT_WORDS.has(t) && !FILLER_WORDS.has(t),
  );
}

/**
 * Parse NAVAll.txt. AMFI has shipped two layouts, so don't count columns from
 * the left — NAV and Date are always the last two fields, and everything from
 * field 3 up to them describes the scheme:
 *
 *   legacy (6):  Code;ISIN Payout;ISIN Reinvest;Name;NAV;Date
 *   current (8): Code;ISIN Payout;ISIN Reinvest;Name;Plan;Option;NAV;Date
 *
 * The current layout lifted the plan/option qualifiers out of Scheme Name into
 * columns of their own, so we join them back onto the name: the matcher below
 * needs "DIRECT"/"GROWTH"/"IDCW" to be tokens of the row, as they used to be.
 */
export function parseNavAll(text: string, coerceDate: (raw: string) => string | null): AmfiRow[] {
  const rows: AmfiRow[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(";");
    if (parts.length < 6) continue; // section + AMC heading lines carry no fields
    const nav = Number(parts[parts.length - 2].trim());
    const date = coerceDate(parts[parts.length - 1].trim());
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue; // also drops the header row
    const isins = [parts[1].trim(), parts[2].trim()].filter((i) => /^IN[A-Z0-9]{10}$/.test(i));
    const name = parts
      .slice(3, -2)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    if (!name) continue;
    rows.push({ isins, name, tokens: tokenize(name), nav, date });
  }
  return rows;
}

/** Word-level, plan/option-aware unique match of a fund name to an AMFI row. */
export function matchAmfiByName(fundName: string, rows: AmfiRow[]): AmfiRow | null {
  const fTokens = tokenize(fundName);
  const core = coreTokens(fTokens);
  if (core.length < 2) return null;
  const coreSet = new Set(core);
  const wantDirect = fTokens.includes("DIRECT");
  const wantRegular = fTokens.includes("REGULAR");
  const wantPayout = fTokens.some((t) => PAYOUT_WORDS.has(t)); // else growth — the default

  const scored: Array<{ row: AmfiRow; extra: number; score: number }> = [];
  for (const row of rows) {
    const rSet = new Set(row.tokens);
    if (!core.every((t) => rSet.has(t))) continue;
    const hasDirect = rSet.has("DIRECT");
    const hasRegular = rSet.has("REGULAR");
    const hasGrowth = rSet.has("GROWTH");
    const hasPayout = row.tokens.some((t) => PAYOUT_WORDS.has(t));
    if (wantDirect && hasRegular) continue;
    if (wantRegular && hasDirect) continue;
    if (!wantPayout && hasPayout) continue; // growth wanted → skip IDCW/bonus rows
    if (wantPayout && !hasPayout && hasGrowth) continue;
    const extra = coreTokens(row.tokens).filter((t) => !coreSet.has(t)).length;
    const score =
      (wantDirect && hasDirect ? 2 : 0) +
      (!wantPayout && hasGrowth ? 1 : 0) +
      (wantPayout && hasPayout ? 1 : 0);
    scored.push({ row, extra, score });
  }

  scored.sort((a, b) => a.extra - b.extra || b.score - a.score);
  const [best, next] = scored;
  if (!best) return null;
  // Unique winner only: a tie on (extra, score) means we'd be guessing.
  if (next && next.extra === best.extra && next.score === best.score) return null;
  return best.row;
}
