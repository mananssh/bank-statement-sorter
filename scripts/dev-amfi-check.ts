/**
 * Dev-only check of the AMFI scheme-name matcher against a saved NAVAll.txt
 * (download it once yourself — this script makes no network calls). Prints
 * the matched AMFI row + ISIN per fund name, or UNMATCHED.
 *
 *   npx tsx scripts/dev-amfi-check.ts <NAVAll.txt> ["Fund Name" ...]
 *
 * With no fund names, runs a built-in regression set of broker-style names
 * whose AMFI spellings differ (missing "Growth", "Nifty 50" vs "Nifty Next
 * 50"/"Smallcap 250" near-misses, "Midcap" vs "Large and Midcap").
 *
 * Also self-tests both NAVAll.txt column layouts offline (no download needed)
 * — AMFI silently moved plan/option into columns of their own once already.
 */
import fs from "node:fs";
import { coerceDate } from "@/lib/normalize/dates";
import { matchAmfiByName, parseNavAll } from "@/lib/integrations/amfi-match";

const [, , navFile, ...names] = process.argv;
if (!navFile) {
  console.error("usage: npx tsx scripts/dev-amfi-check.ts <NAVAll.txt> [fund names...]");
  process.exit(1);
}

const REGRESSION_SET = [
  "HDFC Gold ETF Fund of Fund Direct Plan Growth",
  "HDFC NIFTY 50 Index Fund Direct Growth",
  "JioBlackRock Nifty 50 Index Fund Direct Growth",
  "Nippon India Small Cap Fund Direct Growth",
  // Must stay unmatched: ambiguous without a plan qualifier.
  "Nippon India Small Cap Fund",
  // Must stay unmatched for a second reason: AMFI leaves Plan/Option blank for
  // some AMCs, so its four live rows (direct/regular x growth/IDCW) are
  // indistinguishable by name. Only ISIN can resolve these — don't guess.
  "Motilal Oswal Midcap Fund Direct Growth",
];

// Layout self-test: both AMFI column layouts must yield the same row, because
// the matcher needs the plan/option words to be tokens of the row's name.
const LAYOUTS: Array<[string, string]> = [
  [
    "legacy 6-col",
    "119063;INF179K01WM1;-;HDFC Nifty 50 Index Fund - Direct Plan - Growth Option;233.676;03-Sep-2026",
  ],
  [
    "current 8-col",
    "119063;INF179K01WM1;-;HDFC Nifty 50 Index Fund;Direct Plan;Growth Option;233.676;03-Sep-2026",
  ],
];
let layoutFail = 0;
for (const [label, line] of LAYOUTS) {
  const [row] = parseNavAll(line, coerceDate);
  const ok =
    row?.nav === 233.676 &&
    row.date === "2026-09-03" &&
    row.isins[0] === "INF179K01WM1" &&
    ["DIRECT", "GROWTH", "NIFTY", "50"].every((t) => row.tokens.includes(t));
  if (!ok) layoutFail++;
  console.log(`${ok ? "✓" : "✗"} layout ${label}`);
  if (!ok) console.log(`    got ${JSON.stringify(row ?? null)}`);
}
console.log();

const rows = parseNavAll(fs.readFileSync(navFile, "utf8"), coerceDate);
console.log(`AMFI rows parsed: ${rows.length}\n`);

let unmatched = 0;
for (const name of names.length ? names : REGRESSION_SET) {
  const hit = matchAmfiByName(name, rows);
  if (hit) {
    console.log(`✓ ${name}`);
    console.log(`    → ${hit.name}  isin=${hit.isins[0] ?? "—"}  nav=${hit.nav} (${hit.date})`);
  } else {
    unmatched++;
    console.log(`✗ ${name} — UNMATCHED`);
  }
}
console.log(`\n${unmatched} unmatched, ${layoutFail} layout failures`);
if (layoutFail) process.exit(1);
