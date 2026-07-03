import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";
import { backupsDir } from "@/lib/config";
import { logError, logSafe } from "@/lib/security/redact";

/**
 * Continuous local persistence, all inside the gitignored data/ folder:
 *
 *  - WAL checkpoint every CHECKPOINT_SECONDS folds the write-ahead log into
 *    the main .db file, so that single file is always complete and copyable.
 *  - A rotating consistent snapshot (VACUUM INTO data/backups/auto-*.db)
 *    every SNAPSHOT_SECONDS, plus one at boot and one on graceful shutdown.
 *  - Restore staging lives in lib/db/restore.ts (fs-only so the DB client can
 *    apply it before opening).
 *
 * SQLite itself already survives restarts and hard kills (the WAL is
 * recovered on next open) — this layer adds point-in-time history so even a
 * bad migration, corruption, or an accidental delete is recoverable.
 */

const CHECKPOINT_SECONDS = Number(process.env.AUTOSAVE_CHECKPOINT_SECONDS) || 60;
const SNAPSHOT_SECONDS = Number(process.env.AUTOSAVE_SNAPSHOT_SECONDS) || 300;
const KEEP: Record<string, number> = { auto: 12, boot: 3, shutdown: 3 };

const globalForAutosave = globalThis as unknown as { __ssAutosave?: boolean };

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** Consistent snapshot named <kind>-<timestamp>.db, then prune old ones of that kind. */
export function takeSnapshot(kind: "auto" | "boot" | "shutdown" | "manual"): string {
  const file = path.join(backupsDir(), `${kind}-${stamp()}.db`);
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  if (kind in KEEP) prune(kind, KEEP[kind]);
  return file;
}

function prune(prefix: string, keep: number): void {
  const dir = backupsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch {
      // best effort
    }
  }
}

export interface BackupInfo {
  name: string;
  size: number;
  mtime: string;
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function startAutosave(): void {
  if (globalForAutosave.__ssAutosave) return;
  globalForAutosave.__ssAutosave = true;

  try {
    takeSnapshot("boot");
    logSafe(
      "autosave",
      `boot snapshot taken; checkpoint every ${CHECKPOINT_SECONDS}s, snapshot every ${SNAPSHOT_SECONDS}s`,
    );
  } catch (e) {
    logError("autosave", e);
  }

  const checkpoint = setInterval(() => {
    try {
      db().pragma("wal_checkpoint(PASSIVE)");
    } catch (e) {
      logError("autosave", e);
    }
  }, CHECKPOINT_SECONDS * 1000);
  checkpoint.unref();

  const snapshot = setInterval(() => {
    try {
      takeSnapshot("auto");
    } catch (e) {
      logError("autosave", e);
    }
  }, SNAPSHOT_SECONDS * 1000);
  snapshot.unref();

  // Runs on normal exit and after Next's graceful signal handling (Ctrl+C).
  // Hard kills skip this — that's what the WAL + rotating snapshots cover.
  process.once("exit", () => {
    try {
      db().pragma("wal_checkpoint(TRUNCATE)");
      takeSnapshot("shutdown");
    } catch {
      // exiting anyway
    }
  });
}
