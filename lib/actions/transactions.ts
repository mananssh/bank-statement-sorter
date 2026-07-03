"use server";

import { updateTag } from "next/cache";
import { db } from "@/lib/db/client";
import { updateTxnEnrichment } from "@/lib/repos/transactions";
import { recordConfirmation } from "@/lib/categorize/learn";
import { confirmTransferLink, rejectTransferLink } from "@/lib/categorize/transfers";
import type { TransactionRow } from "@/lib/db/types";

export async function updateTxnAction(
  txnId: number,
  patch: { category_id?: number | null; party_id?: number | null; description?: string | null },
) {
  updateTxnEnrichment(txnId, patch);

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
