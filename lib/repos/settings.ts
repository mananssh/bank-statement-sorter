import "server-only";
import { db } from "@/lib/db/client";

export function getSetting<T>(key: string, fallback: T): T {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, JSON.stringify(value));
}

export function fyStartMonth(): number {
  return getSetting<number>("fy_start_month", 4);
}

export function currencySymbol(): string {
  const code = getSetting<string>("currency", "INR");
  return code === "INR" ? "₹" : code + " ";
}
