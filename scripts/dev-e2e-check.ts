/**
 * Dev-only integration check of the full import pipeline against real data,
 * using an isolated DATA_DIR. Run with the react-server condition so
 * "server-only" modules load:
 *
 *   DATA_DIR=<tmp> NODE_OPTIONS=--conditions=react-server npx tsx scripts/dev-e2e-check.ts <mastersheet.xlsx> <statements.xlsx> <sheet>
 */
import fs from "node:fs";
import { db } from "@/lib/db/client";
import { bootstrapMastersheet } from "@/lib/import/bootstrap-mastersheet";
import {
  analyzeSheet,
  commitBatch,
  createBatch,
  listBatchRows,
  stageBatch,
} from "@/lib/import/ingest";

const [, , mastersheetPath, statementsPath, sheetName] = process.argv;

async function main() {
  const conn = db();

  // 1. account
  conn
    .prepare(
      `INSERT INTO accounts (name, type, institution, number_last4) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO NOTHING`,
    )
    .run("HDFC Savings", "bank", "HDFC Bank", "0109");
  const accountId = (
    conn.prepare(`SELECT id FROM accounts WHERE name = 'HDFC Savings'`).get() as { id: number }
  ).id;
  console.log(`[1] account id=${accountId}`);

  // 2. bootstrap mastersheet (trains memory from a year of manual tagging)
  const msBuffer = fs.readFileSync(mastersheetPath);
  const boot = await bootstrapMastersheet(msBuffer, "mastersheet.xlsx", accountId);
  console.log(
    `[2] bootstrap: ${boot.categories} categories, ${boot.transactions} txns, ${boot.duplicates} dups, months=${boot.monthsFound.length}`,
  );
  const memory = (conn.prepare(`SELECT COUNT(*) AS n FROM narration_memory`).get() as { n: number }).n;
  const parties = (conn.prepare(`SELECT COUNT(*) AS n FROM parties`).get() as { n: number }).n;
  console.log(`[2] learned: ${memory} memory keys, ${parties} parties`);

  // 3. import a raw statement sheet through the wizard pipeline
  const stBuffer = fs.readFileSync(statementsPath);
  const created = createBatch(stBuffer, "statement.xlsx");
  if (!created.ok) throw new Error(created.error);
  console.log(`[3] batch ${created.batchId} created (needsPassword=${created.needsPassword})`);

  const analysis = await analyzeSheet(created.batchId, sheetName);
  if (!analysis.detection) throw new Error("no header detected");
  console.log(
    `[3] detected header row ${analysis.detection.headerRow + 1}, preset match: ${analysis.matchedPreset?.name ?? "none"}`,
  );

  const summary = await stageBatch({
    batchId: created.batchId,
    accountId,
    statementKind: "bank",
    headerRow: analysis.detection.headerRow,
    dataStartRow: analysis.detection.dataStartRow,
    columnMap: analysis.detection.columnMap,
    amountStyle: "debit_credit_columns",
    narrationPlugin: "hdfc",
    savePresetName: "HDFC legacy sheet",
  });
  console.log(
    `[4] staged: total=${summary.total} new=${summary.newRows} dup=${summary.duplicates} possibleDup=${summary.possibleDuplicates} untagged=${summary.untagged} warnings=${summary.warnings.length}`,
  );

  const rows = listBatchRows(created.batchId).filter((r) => !r.parse_error);
  const suggested = rows.filter((r) => r.suggested_category_id !== null).length;
  const bySource = new Map<string, number>();
  for (const r of rows) {
    if (r.suggestion_source) bySource.set(r.suggestion_source, (bySource.get(r.suggestion_source) ?? 0) + 1);
  }
  console.log(
    `[5] auto-categorization: ${suggested}/${rows.length} rows suggested (${Math.round((suggested / rows.length) * 100)}%)`,
    Object.fromEntries(bySource),
  );

  const commit = commitBatch(created.batchId);
  console.log(
    `[6] committed: imported=${commit.imported} skipped=${commit.skipped} transfers=${commit.transfersDetected}`,
  );

  // 4. re-import the exact same file → must short-circuit
  const again = createBatch(stBuffer, "statement.xlsx");
  console.log(`[7] re-import same file blocked: ${!again.ok} (${!again.ok ? again.error : ""})`);

  const totalTxns = (conn.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n;
  const untagged = (
    conn.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NULL`).get() as {
      n: number;
    }
  ).n;
  console.log(`[8] final: ${totalTxns} transactions in DB, ${untagged} untagged`);
}

main().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
