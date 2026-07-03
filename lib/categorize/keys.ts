/**
 * Payee keys — the stable identity of a counterparty across transactions.
 * UPI VPAs are the most stable anchor; otherwise the parsed payee name,
 * normalized aggressively (store/branch numbers stripped) so "SWIGGY 4211"
 * and "SWIGGY 883" collapse to one key.
 */

export function normalizePayee(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9@. ]+/g, " ")
    .replace(/\b\d{3,}\b/g, " ") // trailing store/terminal numbers
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The stable part of a UPI id is what's before the "@" — the same handle
 * (`manan04shah@okhdfcbank`, `manan04shah@ybl`) is the same person across PSPs.
 * We key on that local-part so those never split into duplicate parties.
 */
export function vpaHandle(vpa: string): string {
  const v = vpa.toLowerCase().trim();
  const local = v.split("@")[0];
  return local || v;
}

export function payeeKey(txn: {
  counterparty_vpa?: string | null;
  counterparty_raw?: string | null;
  narration?: string | null;
}): string | null {
  if (txn.counterparty_vpa) return vpaHandle(txn.counterparty_vpa);
  if (txn.counterparty_raw) {
    const norm = normalizePayee(txn.counterparty_raw);
    if (norm) return norm;
  }
  // Last resort: normalized narration head — better than nothing for
  // fixed-text rows like "INTEREST PAID TILL ...".
  if (txn.narration) {
    const norm = normalizePayee(txn.narration).slice(0, 60);
    if (norm) return norm;
  }
  return null;
}
