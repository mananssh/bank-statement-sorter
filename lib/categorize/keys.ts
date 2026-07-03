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

export function payeeKey(txn: {
  counterparty_vpa?: string | null;
  counterparty_raw?: string | null;
  narration?: string | null;
}): string | null {
  if (txn.counterparty_vpa) return txn.counterparty_vpa.toLowerCase().trim();
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
