import { createHash } from "node:crypto";

/**
 * Row-level dedup hash. Two imports of overlapping statement periods must
 * produce identical hashes for the same underlying transaction, so the hash
 * uses only fields that come from the bank, normalized aggressively.
 * Genuinely identical rows within one file are distinguished by dupe_seq.
 */
export function txnDedupHash(row: {
  txn_date: string;
  direction: string;
  amount_paise: number;
  ref_number?: string | null;
  narration: string;
}): string {
  const normalizedRef = (row.ref_number ?? "").trim().replace(/^0+/, "");
  const normalizedNarration = row.narration.toUpperCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(
      [row.txn_date, row.direction, row.amount_paise, normalizedRef, normalizedNarration].join("|"),
    )
    .digest("hex");
}

export function fileSha256(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}
