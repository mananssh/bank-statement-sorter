"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";
import {
  analyzeSheet,
  bulkApplyCategory,
  bulkTagUntagged,
  CommitBlockedError,
  commitBatch,
  commitInvestmentBatch,
  createBatch,
  discardBatch,
  listBatchSheets,
  setBatchPassword,
  setBatchRowParty,
  stageBatch,
  updateBatchRow,
  type SchemeMapping,
  type StageSummary,
} from "@/lib/import/ingest";
import type { ColumnMap } from "@/lib/parsers/types";
import { logError } from "@/lib/security/redact";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export async function uploadStatementAction(formData: FormData): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file first." };
  }
  if (file.size > 16 * 1024 * 1024) {
    return { ok: false, error: "File is larger than 16 MB." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = createBatch(buffer, file.name);
  if (!result.ok) return { ok: false, error: result.error };
  redirect(`/import/${result.batchId}`);
}

export async function batchPasswordAction(
  batchId: number,
  formData: FormData,
): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Enter the password." };
  const res = await setBatchPassword(batchId, password);
  if (!res.ok) return { ok: false, error: res.error };
  redirect(`/import/${batchId}`);
}

export async function listSheetsAction(batchId: number): Promise<ActionResult<string[]>> {
  try {
    const { sheets } = await listBatchSheets(batchId);
    return { ok: true, data: sheets };
  } catch (e) {
    logError("import", e);
    return { ok: false, error: "Could not open the workbook." };
  }
}

export async function selectSheetAction(batchId: number, sheetName: string) {
  try {
    return { ok: true as const, data: await analyzeSheet(batchId, sheetName) };
  } catch (e) {
    logError("import", e);
    return { ok: false as const, error: "Could not read that sheet." };
  }
}

const stageSchema = z.object({
  batchId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  statementKind: z.enum(["bank", "credit_card", "mf_orders"]),
  headerRow: z.number().int().min(0).nullable(),
  dataStartRow: z.number().int().min(0),
  columnMap: z.record(z.string(), z.number().int().min(0)),
  amountStyle: z.enum(["debit_credit_columns", "signed_amount", "amount_with_drcr_flag"]),
  narrationPlugin: z.string().nullable(),
  presetId: z.number().int().positive().nullable().optional(),
  savePresetName: z.string().max(120).nullable().optional(),
});

export async function stageBatchAction(input: unknown): Promise<ActionResult<StageSummary>> {
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid mapping." };
  try {
    const summary = await stageBatch({
      ...parsed.data,
      columnMap: parsed.data.columnMap as ColumnMap,
      presetId: parsed.data.presetId ?? null,
      savePresetName: parsed.data.savePresetName ?? null,
    });
    return { ok: true, data: summary };
  } catch (e) {
    logError("import", e);
    return { ok: false, error: "Parsing failed — check the mapping." };
  }
}

export async function updateRowAction(
  rowId: number,
  patch: {
    category_id?: number | null;
    party_id?: number | null;
    description?: string | null;
    include?: boolean;
  },
): Promise<ActionResult> {
  updateBatchRow(rowId, patch);
  return { ok: true };
}

export async function bulkApplyAction(
  rowId: number,
  categoryId: number,
): Promise<ActionResult<number>> {
  const n = bulkApplyCategory(rowId, categoryId);
  return { ok: true, data: n };
}

export async function bulkTagUntaggedAction(
  batchId: number,
  categoryId: number,
): Promise<ActionResult<number>> {
  const n = bulkTagUntagged(batchId, categoryId);
  return { ok: true, data: n };
}

export async function setRowPartyAction(
  rowId: number,
  name: string | null,
): Promise<ActionResult<{ id: number; name: string } | null>> {
  return { ok: true, data: setBatchRowParty(rowId, name) };
}

export async function commitBatchAction(batchId: number): Promise<ActionResult> {
  try {
    const summary = commitBatch(batchId);
    updateTag("txns");
    redirect(
      `/transactions?imported=${summary.imported}&skipped=${summary.skipped}&transfers=${summary.transfersDetected}`,
    );
  } catch (e) {
    // redirect() throws internally — rethrow anything that is not a real error
    if (e && typeof e === "object" && "digest" in e) throw e;
    if (e instanceof CommitBlockedError) return { ok: false, error: e.message };
    logError("import", e);
    return { ok: false, error: "Commit failed — nothing was written." };
  }
}

export async function discardBatchAction(batchId: number): Promise<ActionResult> {
  discardBatch(batchId);
  redirect("/import");
}

const schemeMappingSchema = z.array(
  z.object({
    key: z.string().min(1),
    fund_id: z.number().int().positive().optional(),
    new_instrument: z
      .object({
        name: z.string().min(1).max(200),
        instrument_kind: z.enum(["mutual_fund", "stock", "etf", "ppf", "epf", "nps", "bond", "other"]),
        asset_class: z.enum(["equity", "debt", "gold", "elss", "hybrid", "other"]),
        sub_category: z.string().max(60).nullable(),
        is_elss: z.boolean(),
        isin: z.string().max(20).nullable(),
        platform: z.string().max(60).nullable(),
      })
      .optional(),
  }),
);

export async function commitInvestmentBatchAction(
  batchId: number,
  mappings: unknown,
): Promise<ActionResult> {
  const parsed = schemeMappingSchema.safeParse(mappings);
  if (!parsed.success) return { ok: false, error: "Invalid instrument mapping." };
  try {
    const summary = commitInvestmentBatch(batchId, parsed.data as SchemeMapping[]);
    updateTag("investments");
    updateTag("txns");
    redirect(
      `/investments?imported=${summary.imported}&skipped=${summary.skipped}&created=${summary.fundsCreated}&linked=${summary.linkedBankTxns}`,
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    logError("import", e);
    return { ok: false, error: e instanceof Error ? e.message : "Commit failed — nothing was written." };
  }
}
