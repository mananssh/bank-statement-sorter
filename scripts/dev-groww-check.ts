/**
 * Dev-only integration check of the Groww MF order-history import against
 * real export files, using an isolated DATA_DIR. Verifies: preset fingerprint
 * auto-match, staging, scheme auto-matching via aliases on the second file,
 * commit into investment_txns, NAV backfill, content dedup on re-import, and
 * holdings/XIRR output. Prints stats only — no personal data.
 *
 *   DATA_DIR=<tmp> NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/dev-groww-check.ts <orders1.xlsx> [orders2.xlsx]
 */
import fs from "node:fs";
import { db } from "@/lib/db/client";
import {
  analyzeSheet,
  commitInvestmentBatch,
  createBatch,
  getInvestmentReviewData,
  stageBatch,
  type SchemeMapping,
} from "@/lib/import/ingest";
import { listHoldings, portfolioSummary } from "@/lib/repos/investments";
import type { ColumnMap } from "@/lib/parsers/types";
import type { AmountStyle, ImportPresetRow, StatementKind } from "@/lib/db/types";

const [, , file1, file2] = process.argv;

async function importFile(path: string, accountId: number, label: string) {
  const buffer = fs.readFileSync(path);
  const created = createBatch(buffer, path.split(/[\\/]/).pop()!);
  if (!created.ok) {
    console.log(`[${label}] createBatch: ${created.error}`);
    return null;
  }
  console.log(`[${label}] batch ${created.batchId}, needsPassword=${created.needsPassword}`);

  const wbSheets = await import("@/lib/import/ingest").then((m) => m.listBatchSheets(created.batchId));
  const sheet = wbSheets.sheets[0];
  const analysis = await analyzeSheet(created.batchId, sheet);
  console.log(
    `[${label}] sheet="${sheet}" headerRow=${analysis.detection?.headerRow} preset=${analysis.matchedPreset?.name ?? "NONE"}`,
  );
  if (!analysis.matchedPreset) throw new Error("Groww preset did not fingerprint-match!");

  const preset = db()
    .prepare(`SELECT * FROM import_presets WHERE id = ?`)
    .get(analysis.matchedPreset.id) as ImportPresetRow;

  const summary = await stageBatch({
    batchId: created.batchId,
    accountId,
    statementKind: preset.statement_kind as StatementKind,
    headerRow: analysis.detection!.headerRow,
    dataStartRow: analysis.detection!.dataStartRow,
    columnMap: JSON.parse(preset.column_map) as ColumnMap,
    amountStyle: preset.amount_style as AmountStyle,
    narrationPlugin: preset.narration_plugin,
    presetId: preset.id,
  });
  console.log(
    `[${label}] staged: total=${summary.total} new=${summary.newRows} dup=${summary.duplicates} issues=${summary.issues} unmatchedSchemes=${summary.untagged}`,
  );

  const review = getInvestmentReviewData(created.batchId);
  const mappings: SchemeMapping[] = review.schemes.map((g) => {
    if (g.suggested_fund_id) return { key: g.key, fund_id: g.suggested_fund_id };
    const lower = g.scheme.toLowerCase();
    const asset_class = lower.includes("gold") ? "gold" : "equity";
    const sub_category = lower.includes("gold")
      ? "Gold FoF"
      : lower.includes("small cap")
        ? "Small Cap"
        : lower.includes("midcap") || lower.includes("mid cap")
          ? "Mid Cap"
          : lower.includes("nifty") || lower.includes("index")
            ? "Large Cap"
            : null;
    return {
      key: g.key,
      new_instrument: {
        name: g.scheme.trim(),
        instrument_kind: "mutual_fund",
        asset_class,
        sub_category,
        is_elss: false,
        isin: null,
        platform: "Groww",
      },
    };
  });
  const autoMatched = review.schemes.filter((g) => g.suggested_fund_id).length;
  console.log(`[${label}] schemes=${review.schemes.length} autoMatched=${autoMatched}`);

  const commit = commitInvestmentBatch(created.batchId, mappings);
  console.log(
    `[${label}] committed: imported=${commit.imported} skipped=${commit.skipped} fundsCreated=${commit.fundsCreated} linkedBank=${commit.linkedBankTxns}`,
  );
  return commit;
}

async function main() {
  db(); // migrate + seed
  const acct = db()
    .prepare(`INSERT INTO accounts (name, type, institution) VALUES ('Groww', 'investment', 'Groww')`)
    .run();
  const accountId = Number(acct.lastInsertRowid);

  await importFile(file1, accountId, "file1");
  if (file2) await importFile(file2, accountId, "file2");

  // Re-import file1 → identical file must short-circuit at the file level.
  const again = createBatch(fs.readFileSync(file1), "copy-of-file1.xlsx");
  console.log(`[re-import] expected file-level block: ${again.ok ? "NOT BLOCKED ✗" : "blocked ✓"}`);

  const holdings = listHoldings();
  console.log(`\nHoldings (${holdings.length}):`);
  for (const h of holdings) {
    console.log(
      `  ${h.name.slice(0, 44).padEnd(44)} units=${h.units.toFixed(2).padStart(9)} ` +
        `invested=₹${(h.cost_basis_paise / 100).toFixed(0).padStart(7)} ` +
        `value=${h.market_value_paise !== null ? "₹" + (h.market_value_paise / 100).toFixed(0) : "—"} ` +
        `xirr=${h.xirr_pct !== null ? h.xirr_pct.toFixed(1) + "%" : "—"}`,
    );
  }
  const s = portfolioSummary(holdings);
  console.log(
    `\nPortfolio: invested=₹${(s.invested_paise / 100).toFixed(0)} value=₹${(s.value_paise / 100).toFixed(0)} ` +
      `pnl=₹${(s.pnl_paise / 100).toFixed(0)} xirr=${s.xirr_pct?.toFixed(2)}%`,
  );
  const navs = db().prepare(`SELECT COUNT(*) AS n FROM fund_navs`).get() as { n: number };
  const txns = db().prepare(`SELECT COUNT(*) AS n FROM investment_txns`).get() as { n: number };
  const aliases = db().prepare(`SELECT COUNT(*) AS n FROM fund_aliases`).get() as { n: number };
  console.log(`fund_navs=${navs.n} investment_txns=${txns.n} fund_aliases=${aliases.n}`);
}

main().catch((e) => {
  console.error("CHECK FAILED:", e);
  process.exit(1);
});
