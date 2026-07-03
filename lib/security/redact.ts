/**
 * Log hygiene: anything that might be logged goes through redact() first.
 * Masks long digit runs (account/card/reference numbers) and UPI VPAs.
 * Raw statement rows never go to the console at all — parse failures are
 * stored in the import_errors table inside the DB trust boundary.
 */
export function redact(message: string): string {
  return message
    .replace(/\d{5,}/g, (m) => `${"*".repeat(Math.max(m.length - 4, 1))}${m.slice(-4)}`)
    .replace(/[\w.\-]{2,}@[a-z][a-z0-9]{1,15}/gi, "***@***");
}

export function logSafe(prefix: string, message: string): void {
  console.log(`[${prefix}] ${redact(message)}`);
}

export function logError(prefix: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[${prefix}] ${redact(msg)}`);
}
