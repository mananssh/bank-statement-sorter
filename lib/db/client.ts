import "server-only";
import DatabaseConstructor, { type Database } from "better-sqlite3";
import { dbPath } from "@/lib/config";
import { migrate } from "@/lib/db/migrate";

// Singleton on globalThis so dev HMR doesn't leak connections.
const globalForDb = globalThis as unknown as { __ssDb?: Database };

export function db(): Database {
  if (!globalForDb.__ssDb) {
    const conn = new DatabaseConstructor(dbPath());
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.pragma("synchronous = NORMAL");
    conn.pragma("busy_timeout = 5000");
    migrate(conn);
    globalForDb.__ssDb = conn;
  }
  return globalForDb.__ssDb;
}
