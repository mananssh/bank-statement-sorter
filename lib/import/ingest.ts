import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";
import { dataDir } from "@/lib/config";
import { fileSha256, txnDedupHash } from "@/lib/domain/dedup";
import { fyStartYear } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";
import { openWorkbook, WorkbookPasswordRequiredError } from "@/lib/parsers/workbook";
import { isEncryptedWorkbook } from "@/lib/parsers/decrypt";
import { gridPreview } from "@/lib/parsers/grid";
import { detectHeader, headerFingerprint } from "@/lib/parsers/detect";
import { parseGrid } from "@/lib/parsers/parse";
import type { ColumnMap, MappingSpec } from "@/lib/parsers/types";
import type { AmountStyle, ImportBatchRow, ImportRowRow, StatementKind } from "@/lib/db/types";
import { resolve } from "@/lib/categorize/resolver";
import { recordConfirmation } from "@/lib/categorize/learn";
import { detectTransfers } from "@/lib/categorize/transfers";
import { payeeKey } from "@/lib/categorize/keys";

/**
 * Import pipeline orchestration. The uploaded file's ORIGINAL bytes are held
 * as a temp file under DATA_DIR/tmp for the duration of the wizard (deleted on
 * commit/discard/GC); decrypted content and passwords are never written to
 * disk — passwords live in an in-memory map only.
 */

const passwordStore = (globalThis as unknown as {
  __ssPw?: Map<number, string>;
}).__ssPw ??= new Map<number, string>();

function tmpDir(): string {
  const dir = path.join(dataDir(), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function batchFilePath(batchId: number): string {
  return path.join(tmpDir(), `batch-${batchId}.orig`);
}

export function getBatch(batchId: number): ImportBatchRow | undefined {
  return db().prepare(`SELECT * FROM import_batches WHERE id = ?`).get(batchId) as
    | ImportBatchRow
    | undefined;
}

function updateBatchMeta(batchId: number, patch: Record<string, unknown>): void {
  const batch = getBatch(batchId);
  if (!batch) return;
  const meta = { ...JSON.parse(batch.meta), ...patch };
  db().prepare(`UPDATE import_batches SET meta = ? WHERE id = ?`).run(JSON.stringify(meta), batchId);
}

/** Drop staging batches older than 24h along with their temp files. */
export function gcStaleBatches(): void {
  const stale = db()
    .prepare(
      `SELECT id FROM import_batches
       WHERE status = 'staging' AND created_at < datetime('now', '-1 day')`,
    )
    .all() as Array<{ id: number }>;
  for (const { id } of stale) {
    try {
      fs.rmSync(batchFilePath(id), { force: true });
    } catch {
      // best effort
    }
    passwordStore.delete(id);
    db().prepare(`UPDATE import_batches SET status = 'discarded' WHERE id = ?`).run(id);
  }
}

export type CreateBatchResult =
  | { ok: true; batchId: number; needsPassword: boolean }
  | { ok: false; error: string };

export function createBatch(buffer: Buffer, fileName: string): CreateBatchResult {
  gcStaleBatches();

  const sha = fileSha256(buffer);
  const existing = db()
    .prepare(`SELECT id, file_name FROM statements WHERE file_sha256 = ?`)
    .get(sha) as { id: number; file_name: string } | undefined;
  if (existing) {
    return { ok: false, error: `This exact file was already imported as "${existing.file_name}".` };
  }

  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  const fileKind = ext === "xls" ? "xls" : ext === "csv" ? "csv" : "xlsx";
  const needsPassword = isEncryptedWorkbook(buffer);

  const res = db()
    .prepare(
      `INSERT INTO import_batches (file_name, file_sha256, file_kind, meta)
       VALUES (?, ?, ?, ?)`,
    )
    .run(fileName, sha, fileKind, JSON.stringify({ step: needsPassword ? "password" : "sheet" }));
  const batchId = Number(res.lastInsertRowid);

  fs.writeFileSync(batchFilePath(batchId), buffer, { mode: 0o600 });
  return { ok: true, batchId, needsPassword };
}

async function openBatchWorkbook(batchId: number) {
  const buffer = fs.readFileSync(batchFilePath(batchId));
  return openWorkbook(buffer, passwordStore.get(batchId));
}

export async function setBatchPassword(
  batchId: number,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  passwordStore.set(batchId, password);
  try {
    await openBatchWorkbook(batchId);
    updateBatchMeta(batchId, { step: "sheet" });
    return { ok: true };
  } catch {
    passwordStore.delete(batchId);
    return { ok: false, error: "Wrong password — could not decrypt the workbook." };
  }
}

export interface SheetInfo {
  sheets: string[];
}

export async function listBatchSheets(batchId: number): Promise<SheetInfo> {
  const wb = await openBatchWorkbook(batchId);
  return { sheets: wb.sheetNames };
}

export interface SheetAnalysis {
  preview: string[][];
  detection: {
    headerRow: number;
    dataStartRow: number;
    columnMap: ColumnMap;
    fingerprint: string;
  } | null;
  matchedPreset: { id: number; name: string; account_id: number | null } | null;
}

/** Analyze the chosen sheet: preview grid, header detection, preset match. */
export async function analyzeSheet(batchId: number, sheetName: string): Promise<SheetAnalysis> {
  const wb = await openBatchWorkbook(batchId);
  const grid = wb.grid(sheetName);
  const preview = gridPreview(grid);
  const detection = detectHeader(grid);

  let matchedPreset: SheetAnalysis["matchedPreset"] = null;
  if (detection) {
    const preset = db()
      .prepare(`SELECT id, name FROM import_presets WHERE header_fingerprint = ?`)
      .get(detection.fingerprint) as { id: number; name: string } | undefined;
    if (preset) {
      const account = db()
        .prepare(`SELECT id FROM accounts WHERE default_preset_id = ? AND is_active = 1 LIMIT 1`)
        .get(preset.id) as { id: number } | undefined;
      matchedPreset = { ...preset, account_id: account?.id ?? null };
    }
  }

  updateBatchMeta(batchId, {
    step: "mapping",
    sheet: sheetName,
    detection,
    matched_preset_id: matchedPreset?.id ?? null,
  });
  db().prepare(`UPDATE import_batches SET sheet_name = ? WHERE id = ?`).run(sheetName, batchId);

  return {
    preview,
    detection: detection
      ? {
          headerRow: detection.headerRow,
          dataStartRow: detection.dataStartRow,
          columnMap: detection.columnMap,
          fingerprint: detection.fingerprint,
        }
      : null,
    matchedPreset,
  };
}

export interface StageInput {
  batchId: number;
  accountId: number;
  statementKind: StatementKind;
  headerRow: number | null;
  dataStartRow: number;
  columnMap: ColumnMap;
  amountStyle: AmountStyle;
  narrationPlugin: string | null;
  presetId?: number | null;
  savePresetName?: string | null;
}

export interface StageSummary {
  total: number;
  newRows: number;
  duplicates: number;
  possibleDuplicates: number;
  issues: number;
  untagged: number;
  warnings: string[];
}

/** Parse, dedup, balance-check, categorize → staging rows. Idempotent per batch. */
export async function stageBatch(input: StageInput): Promise<StageSummary> {
  const batch = getBatch(input.batchId);
  if (!batch || !batch.sheet_name) throw new Error("Batch not ready for staging");

  const wb = await openBatchWorkbook(input.batchId);
  const grid = wb.grid(batch.sheet_name);

  const spec: MappingSpec = {
    statementKind: input.statementKind,
    headerRow: input.headerRow,
    dataStartRow: input.dataStartRow,
    columnMap: input.columnMap,
    amountStyle: input.amountStyle,
    narrationPlugin: input.narrationPlugin,
  };
  const result = parseGrid(grid, spec);
  const conn = db();
  const warnings: string[] = [];

  // Optionally persist the mapping as a reusable preset.
  let presetId = input.presetId ?? null;
  if (!presetId && input.savePresetName) {
    const headerCells = input.headerRow !== null ? grid[input.headerRow] ?? [] : [];
    const account = conn
      .prepare(`SELECT type, institution FROM accounts WHERE id = ?`)
      .get(input.accountId) as { type: string; institution: string } | undefined;
    const res = conn
      .prepare(
        `INSERT INTO import_presets
           (name, institution, account_type, statement_kind, file_kind, sheet_selector,
            header_row, data_start_row, column_map, amount_style, header_fingerprint,
            narration_plugin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           column_map = excluded.column_map,
           header_fingerprint = excluded.header_fingerprint`,
      )
      .run(
        input.savePresetName,
        account?.institution ?? "",
        account?.type ?? "bank",
        input.statementKind,
        batch.file_kind,
        batch.sheet_name,
        input.headerRow,
        input.dataStartRow,
        JSON.stringify(input.columnMap),
        input.amountStyle,
        headerCells.length ? headerFingerprint(headerCells) : null,
        input.narrationPlugin,
      );
    presetId = Number(res.lastInsertRowid);
    conn
      .prepare(`UPDATE accounts SET default_preset_id = ? WHERE id = ? AND default_preset_id IS NULL`)
      .run(presetId, input.accountId);
  }

  // Balance continuity (bank statements with balances only).
  const bankTxns = result.txns;
  if (input.statementKind === "bank" && bankTxns.length > 1) {
    let gaps = 0;
    for (let i = 1; i < bankTxns.length; i++) {
      const prev = bankTxns[i - 1];
      const cur = bankTxns[i];
      if (prev.balance_paise === null || cur.balance_paise === null) continue;
      const delta = cur.direction === "credit" ? cur.amount_paise : -cur.amount_paise;
      if (prev.balance_paise + delta !== cur.balance_paise) gaps++;
    }
    if (gaps > 0) {
      warnings.push(
        `${gaps} row(s) break running-balance continuity — the export may be reordered or missing rows.`,
      );
    }
    const lastCommitted = conn
      .prepare(
        `SELECT balance_paise FROM transactions WHERE account_id = ? AND balance_paise IS NOT NULL
         ORDER BY txn_date DESC, id DESC LIMIT 1`,
      )
      .get(input.accountId) as { balance_paise: number } | undefined;
    const first = bankTxns[0];
    if (lastCommitted && first?.balance_paise !== null && first) {
      const expectedOpening =
        first.direction === "credit"
          ? first.balance_paise - first.amount_paise
          : first.balance_paise + first.amount_paise;
      if (expectedOpening !== lastCommitted.balance_paise) {
        warnings.push(
          "Opening balance doesn't continue from the last imported statement — you may be missing a statement in between.",
        );
      }
    }
  }

  const existsStmt = conn.prepare(
    `SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND dedup_hash = ? AND dupe_seq = ?`,
  );
  const insertRow = conn.prepare(
    `INSERT INTO import_rows
       (batch_id, row_no, txn_date, narration, ref_number, direction, amount_paise,
        balance_paise, channel, counterparty_raw, counterparty_vpa, upi_rrn, upi_note,
        parsed, suggested_category_id, suggested_party_id, suggestion_source,
        suggestion_confidence, dedup_hash, dupe_seq, dup_status, include, parse_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let duplicates = 0;
  let possibleDuplicates = 0;
  let untagged = 0;

  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM import_rows WHERE batch_id = ?`).run(input.batchId);

    const seqCounter = new Map<string, number>();
    for (const t of result.txns) {
      const hash = txnDedupHash(t);
      const seq = seqCounter.get(hash) ?? 0;
      seqCounter.set(hash, seq + 1);

      const isDup =
        (existsStmt.get(input.accountId, hash, seq) as { n: number }).n > 0;
      let dupStatus: "new" | "duplicate" | "possible_duplicate" = isDup ? "duplicate" : "new";
      if (!isDup && !t.ref_number) {
        const fuzzy = conn
          .prepare(
            `SELECT COUNT(*) AS n FROM transactions
             WHERE account_id = ? AND txn_date = ? AND amount_paise = ? AND direction = ?`,
          )
          .get(input.accountId, t.txn_date, t.amount_paise, t.direction) as { n: number };
        if (fuzzy.n > 0) dupStatus = "possible_duplicate";
      }
      if (dupStatus === "duplicate") duplicates++;
      if (dupStatus === "possible_duplicate") possibleDuplicates++;

      const suggestion = resolve(conn, {
        account_id: input.accountId,
        narration: t.narration,
        ref_number: t.ref_number,
        direction: t.direction,
        amount_paise: t.amount_paise,
        channel: t.channel,
        counterparty_raw: t.counterparty_raw,
        counterparty_vpa: t.counterparty_vpa,
      });
      if (!suggestion.category_id && dupStatus === "new") untagged++;

      insertRow.run(
        input.batchId,
        t.row_no,
        t.txn_date,
        t.narration,
        t.ref_number,
        t.direction,
        t.amount_paise,
        t.balance_paise,
        t.channel,
        t.counterparty_raw,
        t.counterparty_vpa,
        t.upi_rrn,
        t.upi_note,
        JSON.stringify(t.parsed),
        suggestion.category_id,
        suggestion.party_id,
        suggestion.source,
        suggestion.confidence,
        hash,
        seq,
        dupStatus,
        dupStatus === "duplicate" ? 0 : 1,
        null,
      );
    }

    // Parse issues become excluded rows the user can see.
    for (const issue of result.issues) {
      insertRow.run(
        input.batchId,
        issue.row_no,
        null,
        JSON.stringify(issue.raw).slice(0, 500),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "{}",
        null,
        null,
        null,
        0,
        null,
        0,
        "new",
        0,
        issue.error,
      );
    }

    conn
      .prepare(
        `UPDATE import_batches SET account_id = ?, preset_id = ?, statement_kind = ?,
           warnings = ?, meta = json_set(meta, '$.step', 'review',
             '$.mapping', json(?)) WHERE id = ?`,
      )
      .run(
        input.accountId,
        presetId,
        input.statementKind,
        JSON.stringify(warnings),
        JSON.stringify({
          headerRow: input.headerRow,
          dataStartRow: input.dataStartRow,
          columnMap: input.columnMap,
          amountStyle: input.amountStyle,
          narrationPlugin: input.narrationPlugin,
        }),
        input.batchId,
      );
  });
  tx();

  return {
    total: result.txns.length,
    newRows: result.txns.length - duplicates,
    duplicates,
    possibleDuplicates,
    issues: result.issues.length,
    untagged,
    warnings,
  };
}

export function listBatchRows(batchId: number): ImportRowRow[] {
  return db()
    .prepare(`SELECT * FROM import_rows WHERE batch_id = ? ORDER BY row_no`)
    .all(batchId) as ImportRowRow[];
}

export function updateBatchRow(
  rowId: number,
  patch: {
    category_id?: number | null;
    party_id?: number | null;
    description?: string | null;
    include?: boolean;
  },
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: rowId };
  if ("category_id" in patch) {
    sets.push("user_category_id = @cat");
    params.cat = patch.category_id;
  }
  if ("party_id" in patch) {
    sets.push("user_party_id = @party");
    params.party = patch.party_id;
  }
  if ("description" in patch) {
    sets.push("description = @desc");
    params.desc = patch.description;
  }
  if ("include" in patch) {
    sets.push("include = @inc");
    params.inc = patch.include ? 1 : 0;
  }
  if (!sets.length) return;
  db().prepare(`UPDATE import_rows SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

/**
 * Set (or clear) a staged row's party by name, finding-or-creating the party.
 * Returns the resolved party so the client can reflect it.
 */
export function setBatchRowParty(
  rowId: number,
  name: string | null,
): { id: number; name: string } | null {
  const conn = db();
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    conn.prepare(`UPDATE import_rows SET user_party_id = NULL WHERE id = ?`).run(rowId);
    return null;
  }
  const existing = conn
    .prepare(`SELECT id, canonical_name FROM parties WHERE canonical_name = ?`)
    .get(trimmed) as { id: number; canonical_name: string } | undefined;
  const id =
    existing?.id ??
    Number(conn.prepare(`INSERT INTO parties (canonical_name) VALUES (?)`).run(trimmed).lastInsertRowid);
  conn.prepare(`UPDATE import_rows SET user_party_id = ? WHERE id = ?`).run(id, rowId);
  return { id, name: existing?.canonical_name ?? trimmed };
}

/**
 * Tag every still-untagged, included row whose direction matches the chosen
 * category's type (income→credit, expense/investment→debit) with that category.
 * Powers the "tag all untagged expenses as …" bulk controls. Returns the count.
 */
export function bulkTagUntagged(batchId: number, categoryId: number): number {
  const conn = db();
  const cat = conn.prepare(`SELECT type FROM categories WHERE id = ?`).get(categoryId) as
    | { type: string }
    | undefined;
  if (!cat) return 0;

  const directions =
    cat.type === "income" ? ["credit"] : cat.type === "transfer" ? ["credit", "debit"] : ["debit"];
  const placeholders = directions.map(() => "?").join(", ");
  const res = conn
    .prepare(
      `UPDATE import_rows SET user_category_id = ?
       WHERE batch_id = ? AND include = 1 AND parse_error IS NULL
         AND user_category_id IS NULL AND suggested_category_id IS NULL
         AND direction IN (${placeholders})`,
    )
    .run(categoryId, batchId, ...directions);
  return res.changes;
}

/** Apply a category to every stageable row in the batch sharing this row's payee key. */
export function bulkApplyCategory(rowId: number, categoryId: number): number {
  const conn = db();
  const row = conn.prepare(`SELECT * FROM import_rows WHERE id = ?`).get(rowId) as
    | ImportRowRow
    | undefined;
  if (!row) return 0;
  const key = payeeKey(row);
  if (!key) return 0;

  const siblings = conn
    .prepare(`SELECT * FROM import_rows WHERE batch_id = ? AND include = 1`)
    .all(row.batch_id) as ImportRowRow[];
  let applied = 0;
  const update = conn.prepare(`UPDATE import_rows SET user_category_id = ? WHERE id = ?`);
  for (const s of siblings) {
    if (payeeKey(s) === key) {
      update.run(categoryId, s.id);
      applied++;
    }
  }
  return applied;
}

export interface CommitSummary {
  imported: number;
  skipped: number;
  statementId: number;
  transfersDetected: number;
}

/** Thrown when a commit is attempted with untagged rows — message is user-safe. */
export class CommitBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitBlockedError";
  }
}

/** Single-transaction commit: statement row, txns, learning, transfer scan. */
export function commitBatch(batchId: number): CommitSummary {
  const conn = db();
  const batch = getBatch(batchId);
  if (!batch || batch.status !== "staging" || !batch.account_id) {
    throw new Error("Batch is not ready to commit");
  }
  const accountId = batch.account_id;
  const rows = listBatchRows(batchId).filter((r) => !r.parse_error);
  const included = rows.filter((r) => r.include === 1 && r.txn_date);

  // Every included row must be tagged before it can be committed — the review
  // is not "done" until nothing is untagged (client blocks this too).
  const untagged = included.filter(
    (r) => (r.user_category_id ?? r.suggested_category_id) === null,
  ).length;
  if (untagged > 0) {
    throw new CommitBlockedError(
      `${untagged} transaction(s) are still untagged. Tag them (or use "Tag all untagged") before committing.`,
    );
  }
  const startMonth = fyStartMonth();

  const insertTxn = conn.prepare(
    `INSERT INTO transactions
       (account_id, statement_id, txn_date, narration, ref_number, direction, amount_paise,
        balance_paise, channel, counterparty_raw, counterparty_vpa, upi_rrn, upi_note, parsed,
        category_id, party_id, description, categorized_by, dedup_hash, dupe_seq, fy_start_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, dedup_hash, dupe_seq) DO NOTHING`,
  );

  let imported = 0;
  let statementId = 0;
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  const tx = conn.transaction(() => {
    const stmtRes = conn
      .prepare(
        `INSERT INTO statements
           (account_id, preset_id, file_name, file_sha256, file_kind, rows_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(accountId, batch.preset_id, batch.file_name, batch.file_sha256, batch.file_kind, rows.length);
    statementId = Number(stmtRes.lastInsertRowid);

    for (const r of included) {
      const categoryId = r.user_category_id ?? r.suggested_category_id;
      let partyId = r.user_party_id ?? r.suggested_party_id;

      const categorizedBy =
        r.user_category_id !== null
          ? "manual"
          : r.suggestion_source === "memory"
            ? "memory"
            : r.suggestion_source === "party_default"
              ? "party_default"
              : r.suggested_category_id !== null
                ? "rule"
                : null;

      if (categoryId !== null) {
        const learned = recordConfirmation(conn, {
          account_id: accountId,
          narration: r.narration ?? "",
          counterparty_raw: r.counterparty_raw,
          counterparty_vpa: r.counterparty_vpa,
          category_id: categoryId,
          party_id: partyId,
          suggested_category_id: r.suggested_category_id,
        });
        partyId = learned.party_id ?? partyId;
      }

      const res = insertTxn.run(
        accountId,
        statementId,
        r.txn_date,
        r.narration ?? "",
        r.ref_number,
        r.direction,
        r.amount_paise,
        r.balance_paise,
        r.channel,
        r.counterparty_raw,
        r.counterparty_vpa,
        r.upi_rrn,
        r.upi_note,
        r.parsed,
        categoryId,
        partyId,
        r.description,
        categorizedBy,
        r.dedup_hash,
        r.dupe_seq,
        fyStartYear(r.txn_date!, startMonth),
      );
      if (res.changes > 0) {
        imported++;
        if (!dateMin || r.txn_date! < dateMin) dateMin = r.txn_date!;
        if (!dateMax || r.txn_date! > dateMax) dateMax = r.txn_date!;
      }
    }

    conn
      .prepare(
        `UPDATE statements SET rows_imported = ?, rows_duplicate = ?, period_start = ?, period_end = ?
         WHERE id = ?`,
      )
      .run(imported, rows.length - imported, dateMin, dateMax, statementId);

    // Persist parse errors for review.
    const errRows = listBatchRows(batchId).filter((r) => r.parse_error);
    const insertErr = conn.prepare(
      `INSERT INTO import_errors (statement_id, row_no, raw, error) VALUES (?, ?, ?, ?)`,
    );
    for (const e of errRows) insertErr.run(statementId, e.row_no, e.narration ?? "[]", e.parse_error);

    conn.prepare(`UPDATE import_batches SET status = 'committed' WHERE id = ?`).run(batchId);
    conn.prepare(`DELETE FROM import_rows WHERE batch_id = ?`).run(batchId);
  });
  tx();

  let transfersDetected = 0;
  if (dateMin && dateMax) {
    transfersDetected = detectTransfers(conn, dateMin, dateMax);
  }

  try {
    fs.rmSync(batchFilePath(batchId), { force: true });
  } catch {
    // best effort
  }
  passwordStore.delete(batchId);

  return { imported, skipped: included.length - imported, statementId, transfersDetected };
}

export function discardBatch(batchId: number): void {
  db().prepare(`UPDATE import_batches SET status = 'discarded' WHERE id = ?`).run(batchId);
  db().prepare(`DELETE FROM import_rows WHERE batch_id = ?`).run(batchId);
  try {
    fs.rmSync(batchFilePath(batchId), { force: true });
  } catch {
    // best effort
  }
  passwordStore.delete(batchId);
}
