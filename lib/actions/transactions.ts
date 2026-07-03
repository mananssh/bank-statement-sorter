"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { updateTxnEnrichment } from "@/lib/repos/transactions";
import { recordConfirmation } from "@/lib/categorize/learn";
import { confirmTransferLink, rejectTransferLink } from "@/lib/categorize/transfers";
import {
  candidateDebits,
  getReimbursementLinks,
  getTxnSplits,
  setReimbursementLinks,
  setTxnSplits,
  type CandidateDebit,
  type SplitPortion,
} from "@/lib/repos/reimburse";
import { logError } from "@/lib/security/redact";
import type { TransactionRow } from "@/lib/db/types";

export async function updateTxnAction(
  txnId: number,
  patch: { category_id?: number | null; party_id?: number | null; description?: string | null },
) {
  updateTxnEnrichment(txnId, patch);

  // A manual retag supersedes any earlier split — otherwise the hidden split
  // would keep overriding the visible category in every report.
  if ("category_id" in patch) {
    db().prepare(`DELETE FROM txn_splits WHERE txn_id = ?`).run(txnId);
  }

  // Retagging from the register teaches the memory layer exactly like the
  // review screen does.
  if (patch.category_id) {
    const txn = db().prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId) as
      | TransactionRow
      | undefined;
    if (txn) {
      const learned = recordConfirmation(db(), {
        account_id: txn.account_id,
        narration: txn.narration,
        counterparty_raw: txn.counterparty_raw,
        counterparty_vpa: txn.counterparty_vpa,
        category_id: patch.category_id,
        party_id: patch.party_id ?? txn.party_id,
        suggested_category_id: null,
      });
      if (learned.party_id && !txn.party_id) {
        updateTxnEnrichment(txnId, { party_id: learned.party_id });
      }
    }
  }

  updateTag("txns");
  return { ok: true as const };
}

export interface ReimburseInfo {
  splits: SplitPortion[];
  linkedDebitIds: number[];
  candidates: CandidateDebit[];
}

export async function reimburseInfoAction(
  txnId: number,
  categoryIds: number[],
): Promise<ReimburseInfo> {
  return {
    splits: getTxnSplits(txnId),
    linkedDebitIds: getReimbursementLinks(txnId),
    candidates: candidateDebits(txnId, categoryIds),
  };
}

const saveReimburseSchema = z.object({
  txnId: z.number().int().positive(),
  portions: z
    .array(
      z.object({
        category_id: z.number().int().positive(),
        amount_paise: z.number().int().positive(),
      }),
    )
    .max(20),
  linkedDebitIds: z.array(z.number().int().positive()).max(50),
});

export async function saveReimburseAction(input: unknown) {
  const parsed = saveReimburseSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid split." };
  try {
    setTxnSplits(parsed.data.txnId, parsed.data.portions);
    setReimbursementLinks(parsed.data.txnId, parsed.data.linkedDebitIds);
    updateTag("txns");
    return { ok: true as const };
  } catch (e) {
    logError("reimburse", e);
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not save the split.",
    };
  }
}

export async function confirmTransferAction(linkId: number) {
  confirmTransferLink(db(), linkId);
  updateTag("txns");
  return { ok: true as const };
}

export async function rejectTransferAction(linkId: number) {
  rejectTransferLink(db(), linkId);
  updateTag("txns");
  return { ok: true as const };
}
