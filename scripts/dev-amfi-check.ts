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
  "Motilal Oswal Midcap Fund Direct Growth",
  "JioBlackRock Nifty 50 Index Fund Direct Growth",
  "Nippon India Small Cap Fund Direct Growth",
  // Must stay unmatched: ambiguous without a plan qualifier.
  "Nippon India Small Cap Fund",
];

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
console.log(`\n${unmatched} unmatched`);
