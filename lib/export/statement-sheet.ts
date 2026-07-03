import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/lib/db/client";

/**
 * Enriched per-statement export: the statement's rows in familiar bank-export
 * column order, PLUS the two enrichment columns (Account Name = category,
 * Party Name = counterparty) and Description — the fields that go into
 * accounting tools like Zoho Books.
 */
export async function buildStatementSheet(statementId: number): Promise<{
  buffer: Buffer;
  fileName: string;
} | null> {
  const conn = db();
  const stmt = conn
    .prepare(
      `SELECT s.*, a.name AS account_name FROM statements s
       JOIN accounts a ON a.id = s.account_id WHERE s.id = ?`,
    )
    .get(statementId) as { file_name: string; account_name: string } | undefined;
  if (!stmt) return null;

  const rows = conn
    .prepare(
      `SELECT t.txn_date, t.narration, t.ref_number, t.direction, t.amount_paise,
              t.balance_paise, t.description, t.upi_note,
              c.name AS category_name, p.canonical_name AS party_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN parties p ON p.id = t.party_id
       WHERE t.statement_id = ? ORDER BY t.txn_date, t.id`,
    )
    .all(statementId) as Array<Record<string, unknown>>;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Statement", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addTable({
    name: "EnrichedStatement",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date", filterButton: true },
      { name: "Narration", filterButton: true },
      { name: "Ref No", filterButton: true },
      { name: "Debit", filterButton: true },
      { name: "Credit", filterButton: true },
      { name: "Balance", filterButton: true },
      { name: "Account Name", filterButton: true },
      { name: "Party Name", filterButton: true },
      { name: "Description", filterButton: true },
    ],
    rows: rows.length
      ? rows.map((r) => [
          new Date(`${r.txn_date as string}T00:00:00Z`),
          r.narration,
          r.ref_number,
          r.direction === "debit" ? (r.amount_paise as number) / 100 : null,
          r.direction === "credit" ? (r.amount_paise as number) / 100 : null,
          r.balance_paise !== null ? (r.balance_paise as number) / 100 : null,
          r.category_name,
          r.party_name,
          r.description ?? r.upi_note,
        ])
      : [[null, null, null, null, null, null, null, null, null]],
  });
  ws.getColumn(1).numFmt = "yyyy-mm-dd";
  for (const c of [4, 5, 6]) ws.getColumn(c).numFmt = "#,##0.00";
  ws.getColumn(2).width = 60;
  for (const c of [1, 3, 4, 5, 6, 7, 8, 9]) ws.getColumn(c).width = 16;

  const base = stmt.file_name.replace(/\.(xlsx?|csv)$/i, "");
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    fileName: `${base}-enriched.xlsx`,
  };
}
