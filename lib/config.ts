import path from "node:path";
import fs from "node:fs";

/**
 * Filesystem layout. All financial data lives under DATA_DIR, which is
 * user-configurable via env so it can sit inside whatever folder the user
 * already backs up. Nothing under DATA_DIR is ever committed to git.
 */

export function dataDir(): string {
  const dir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), "statement-sorter.db");
}

export function backupsDir(): string {
  const dir = path.join(dataDir(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionSecretPath(): string {
  return path.join(dataDir(), "session-secret");
}

/** Defaults for the document archive; overridable via env and Settings. */
export function defaultArchiveRoot(): string {
  return process.env.ARCHIVE_ROOT?.trim() || path.join(path.dirname(dataDir()), "archive");
}

export function defaultInboxDir(): string {
  return process.env.INBOX_DIR?.trim() || path.join(path.dirname(dataDir()), "inbox");
}
