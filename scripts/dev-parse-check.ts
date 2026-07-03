/**
 * Dev-only smoke check: run the real parse pipeline (header detection,
 * mapping, date/amount normalization, HDFC narration mining) against a real
 * statement workbook. Prints stats only — no full data dumps.
 *
 * Usage: npx tsx scripts/dev-parse-check.ts <workbook.xlsx> [sheetName]
 */
import * as XLSX from "xlsx";
import fs from "node:fs";
import { detectHeader } from "@/lib/parsers/detect";
import { parseGrid } from "@/lib/parsers/parse";
import type { Grid, MappingSpec } from "@/lib/parsers/types";

const [, , file, sheetArg] = process.argv;
if (!file) {
  console.error("usage: tsx scripts/dev-parse-check.ts <workbook> [sheet]");
  process.exit(1);
}

const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: false });
const sheets = sheetArg ? [sheetArg] : wb.SheetNames;

for (const sheetName of sheets) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as Grid;

  const detection = detectHeader(grid);
  if (!detection) {
    console.log(`\n=== ${sheetName}: no header detected (rows=${grid.length})`);
    continue;
  }

  const spec: MappingSpec = {
    statementKind: "bank",
    headerRow: detection.headerRow,
    dataStartRow: detection.dataStartRow,
    columnMap: detection.columnMap,
    amountStyle:
      detection.columnMap.debit !== undefined || detection.columnMap.credit !== undefined
        ? "debit_credit_columns"
        : detection.columnMap.drcr !== undefined
          ? "amount_with_drcr_flag"
          : "signed_amount",
    narrationPlugin: "hdfc",
  };
  const result = parseGrid(grid, spec);

  const channels = new Map<string, number>();
  let vpa = 0;
  let counterparty = 0;
  let notes = 0;
  let balanceOk = 0;
  let balanceChecks = 0;
  for (let i = 0; i < result.txns.length; i++) {
    const t = result.txns[i];
    channels.set(t.channel ?? "none", (channels.get(t.channel ?? "none") ?? 0) + 1);
    if (t.counterparty_vpa) vpa++;
    if (t.counterparty_raw) counterparty++;
    if (t.upi_note) notes++;
    if (i > 0) {
      const prev = result.txns[i - 1];
      if (prev.balance_paise !== null && t.balance_paise !== null) {
        balanceChecks++;
        const delta = t.direction === "credit" ? t.amount_paise : -t.amount_paise;
        if (prev.balance_paise + delta === t.balance_paise) balanceOk++;
      }
    }
  }

  console.log(`\n=== ${sheetName}`);
  console.log(
    `header row ${detection.headerRow + 1} (score ${detection.score.toFixed(2)}), fields: ${Object.keys(detection.columnMap).join(", ")}`,
  );
  console.log(
    `parsed ${result.txns.length} txns, ${result.issues.length} issues; ` +
      `counterparty ${counterparty}/${result.txns.length}, vpa ${vpa}, upi-notes ${notes}`,
  );
  console.log(
    `balance continuity: ${balanceOk}/${balanceChecks} rows consistent`,
  );
  console.log(`channels:`, Object.fromEntries(channels));
  const sample = result.txns.find((t) => t.channel === "upi" && t.upi_note);
  if (sample) {
    console.log(
      `sample UPI extraction: payee="${sample.counterparty_raw}" vpa=${sample.counterparty_vpa ? "yes" : "no"} rrn=${sample.upi_rrn ? "yes" : "no"} note="${sample.upi_note}"`,
    );
  }
}
