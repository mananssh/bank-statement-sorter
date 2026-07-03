import fs from "node:fs";
import path from "node:path";
import { backupsDir, dbPath } from "@/lib/config";

/**
 * Backup restore staging. Deliberately fs-only (no DB import) so the DB
 * client can call applyPendingRestore() before it opens the database.
 *
 * Flow: Settings copies a chosen snapshot to data/restore-pending.db; on the
 * next server start the client swaps it into place. The replaced database is
 * set aside with a timestamp suffix — never deleted.
 */

function pendingPath(): string {
  return path.join(path.dirname(dbPath()), "restore-pending.db");
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function pendingRestore(): boolean {
  return fs.existsSync(pendingPath());
}

/** Stage a snapshot for restore; it's swapped in on the next server start. */
export function requestRestore(name: string): void {
  const safe = path.basename(name);
  const source = path.join(backupsDir(), safe);
  if (!safe.endsWith(".db") || !fs.existsSync(source)) {
    throw new Error("Unknown backup file.");
  }
  fs.copyFileSync(source, pendingPath());
}

export function cancelRestore(): void {
  fs.rmSync(pendingPath(), { force: true });
}

/** Called by the DB client BEFORE opening. No-op unless a restore is staged. */
export function applyPendingRestore(): void {
  const pending = pendingPath();
  if (!fs.existsSync(pending)) return;
  const main = dbPath();
  const setAside = `${main}.replaced-${stamp()}`;
  if (fs.existsSync(main)) fs.renameSync(main, setAside);
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(main + ext)) fs.renameSync(main + ext, setAside + ext);
  }
  fs.renameSync(pending, main);
  console.log(
    `[autosave] restored backup into place; previous database kept as ${path.basename(setAside)}`,
  );
}
