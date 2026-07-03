import "server-only";
import { db } from "@/lib/db/client";
import { openWorkbook } from "@/lib/parsers/workbook";
import { cellToString, normalizeHeaderCell } from "@/lib/parsers/grid";
import { coerceDate } from "@/lib/normalize/dates";
import { parseAmountToPaise } from "@/lib/domain/money";
import { getNarrationPlugin } from "@/lib/normalize/narration";
import { txnDedupHash, fileSha256 } from "@/lib/domain/dedup";
import { fyStartYear } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";
import { recordConfirmation } from "@/lib/categorize/learn";

/**
 * One-time migration from a legacy FY mastersheet workbook (the
 * Setup / Party_Master / 12 month tabs format). Party_Master becomes
 * categories, month-tab rows become manually-categorized transactions, and a
 * year of hand tagging pre-trains the narration memory. Supported on the
 * IMPORT side only — exports use the app's clean workbook format.
 */

export interface BootstrapResult {
  categories: number;
  transactions: number;
  duplicates: number;
  monthsFound: string[];
  accountId: number;
}

const MONTH_TABS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export async function bootstrapMastersheet(
  buffer: Buffer,
  fileName: string,
  accountId: number,
  password?: string,
): Promise<BootstrapResult> {
  const wb = await openWorkbook(buffer, password);
  const conn = db();
  const startMonth = fyStartMonth();

  // --- Party_Master → categories -------------------------------------------
  let categoriesAdded = 0;
  const partySheet = wb.sheetNames.find((s) => /party[_ ]?master/i.test(s));
  if (partySheet) {
    const grid = wb.grid(partySheet);
    const header = grid[0]?.map(normalizeHeaderCell) ?? [];
    const nameCol = header.findIndex((h) => /party name/.test(h));
    const typeCol = header.findIndex((h) => /party type/.test(h));
    const activeCol = header.findIndex((h) => /is active/.test(h));
    const notesCol = header.findIndex((h) => /notes/.test(h));
    if (nameCol >= 0) {
      const insert = conn.prepare(
        `INSERT INTO categories (name, type, is_active, notes) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO NOTHING`,
      );
      for (let r = 1; r < grid.length; r++) {
        const name = cellToString(grid[r]?.[nameCol]);
        if (!name) continue;
        const rawType = cellToString(typeCol >= 0 ? grid[r]?.[typeCol] : "").toLowerCase();
        const type = ["income", "expense", "investment", "transfer"].includes(rawType)
          ? rawType
          : /credit card/i.test(name)
            ? "transfer"
            : "expense";
        const active = activeCol >= 0 ? (/yes|true|1/i.test(cellToString(grid[r]?.[activeCol])) ? 1 : 0) : 1;
        const res = insert.run(name, type, active, cellToString(notesCol >= 0 ? grid[r]?.[notesCol] : "") || null);
        if (res.changes > 0) categoriesAdded++;
      }
    }
  }

  // --- month tabs → transactions --------------------------------------------
  const plugin = getNarrationPlugin("hdfc");
  const categoryByName = new Map(
    (conn.prepare(`SELECT id, name FROM categories`).all() as Array<{ id: number; name: string }>).map(
      (c) => [c.name.toLowerCase(), c.id],
    ),
  );

  const sha = fileSha256(buffer);
  let statementId: number | null = null;
  const existing = conn
    .prepare(`SELECT id FROM statements WHERE file_sha256 = ?`)
    .get(sha) as { id: number } | undefined;
  if (existing) {
    statementId = existing.id;
  } else {
    statementId = Number(
      conn
        .prepare(
          `INSERT INTO statements (account_id, file_name, file_sha256, file_kind, meta)
           VALUES (?, ?, ?, 'xlsx', '{"bootstrap":true}')`,
        )
        .run(accountId, fileName, sha).lastInsertRowid,
    );
  }

  const insertTxn = conn.prepare(
    `INSERT INTO transactions
       (account_id, statement_id, txn_date, narration, ref_number, direction, amount_paise,
        balance_paise, channel, counterparty_raw, counterparty_vpa, upi_rrn, upi_note, parsed,
        category_id, party_id, description, categorized_by, dedup_hash, dupe_seq, fy_start_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
     ON CONFLICT(account_id, dedup_hash, dupe_seq) DO NOTHING`,
  );

  let transactions = 0;
  let duplicates = 0;
  const monthsFound: string[] = [];
  let rowsImported = 0;

  const tx = conn.transaction(() => {
    for (const tab of MONTH_TABS) {
      const sheetName = wb.sheetNames.find((s) => s.toLowerCase() === tab.toLowerCase());
      if (!sheetName) continue;
      const grid = wb.grid(sheetName);

      // Header row 4 (0-based 3) in the known format, but locate it defensively.
      let headerRow = 3;
      for (let r = 0; r < Math.min(8, grid.length); r++) {
        const cells = grid[r]?.map(normalizeHeaderCell) ?? [];
        if (cells.includes("narration") && cells.some((c) => /date/.test(c))) {
          headerRow = r;
          break;
        }
      }
      const header = grid[headerRow]?.map(normalizeHeaderCell) ?? [];
      const col = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));
      const cDate = col(/^date$/);
      const cNarr = col(/^narration$/);
      const cRef = col(/ref/);
      const cDebit = col(/debit|withdrawal/);
      const cCredit = col(/credit|deposit/);
      const cBalance = col(/balance/);
      const cParty = col(/^party name$/);
      const cDesc = col(/^description/);
      if (cDate < 0 || cNarr < 0) continue;
      monthsFound.push(tab);

      const seqCounter = new Map<string, number>();
      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        const txnDate = coerceDate(row[cDate]);
        const narration = cellToString(row[cNarr]);
        if (!txnDate || !narration) continue;

        const debit = cDebit >= 0 ? parseAmountToPaise(row[cDebit] as string | number) : null;
        const credit = cCredit >= 0 ? parseAmountToPaise(row[cCredit] as string | number) : null;
        const direction = debit && debit > 0 ? "debit" : credit && credit > 0 ? "credit" : null;
        const amount = direction === "debit" ? debit : credit;
        if (!direction || !amount) continue;

        const balance = cBalance >= 0 ? parseAmountToPaise(row[cBalance] as string | number) : null;
        const extraction = plugin.parse(narration);
        const categoryName = cParty >= 0 ? cellToString(row[cParty]).toLowerCase() : "";
        const categoryId = categoryByName.get(categoryName) ?? null;
        const description = cDesc >= 0 ? cellToString(row[cDesc]) || null : null;

        const hashInput = {
          txn_date: txnDate,
          direction,
          amount_paise: amount,
          ref_number: cRef >= 0 ? cellToString(row[cRef]) : null,
          narration,
        };
        const hash = txnDedupHash(hashInput);
        const seq = seqCounter.get(hash) ?? 0;
        seqCounter.set(hash, seq + 1);

        let partyId: number | null = null;
        if (categoryId !== null) {
          const learned = recordConfirmation(conn, {
            account_id: accountId,
            narration,
            counterparty_raw: extraction.counterparty,
            counterparty_vpa: extraction.vpa,
            category_id: categoryId,
            party_id: null,
            suggested_category_id: null,
          });
          partyId = learned.party_id;
        }

        const res = insertTxn.run(
          accountId,
          statementId,
          txnDate,
          narration,
          hashInput.ref_number,
          direction,
          amount,
          balance,
          extraction.channel,
          extraction.counterparty,
          extraction.vpa,
          extraction.rrn,
          extraction.upiNote,
          JSON.stringify(extraction.ifsc ? { ifsc: extraction.ifsc } : {}),
          categoryId,
          partyId,
          description ?? extraction.upiNote,
          hash,
          seq,
          fyStartYear(txnDate, startMonth),
        );
        if (res.changes > 0) {
          transactions++;
          rowsImported++;
        } else {
          duplicates++;
        }
      }
    }

    conn
      .prepare(
        `UPDATE statements SET rows_total = rows_total + ?, rows_imported = rows_imported + ?,
           rows_duplicate = rows_duplicate + ?,
           period_start = (SELECT MIN(txn_date) FROM transactions WHERE statement_id = ?),
           period_end = (SELECT MAX(txn_date) FROM transactions WHERE statement_id = ?)
         WHERE id = ?`,
      )
      .run(
        transactions + duplicates,
        rowsImported,
        duplicates,
        statementId,
        statementId,
        statementId,
      );
  });
  tx();

  return { categories: categoriesAdded, transactions, duplicates, monthsFound, accountId };
}
