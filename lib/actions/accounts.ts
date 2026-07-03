"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";

const accountSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["bank", "credit_card", "investment", "cash"]),
  institution: z.string().max(80).default(""),
  number_last4: z
    .string()
    .max(4)
    .regex(/^\d{0,4}$/)
    .default(""),
  holder_name: z.string().max(80).default(""),
});

export async function createAccountAction(input: unknown) {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid account details." };
  try {
    const res = db()
      .prepare(
        `INSERT INTO accounts (name, type, institution, number_last4, holder_name)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.name,
        parsed.data.type,
        parsed.data.institution,
        parsed.data.number_last4 || null,
        parsed.data.holder_name || null,
      );
    updateTag("accounts");
    return { ok: true as const, id: Number(res.lastInsertRowid) };
  } catch {
    return { ok: false as const, error: "An account with that name already exists." };
  }
}

export async function updateAccountMetaAction(accountId: number, meta: Record<string, unknown>) {
  db().prepare(`UPDATE accounts SET meta = ? WHERE id = ?`).run(JSON.stringify(meta), accountId);
  updateTag("accounts");
  return { ok: true as const };
}

export async function toggleAccountAction(accountId: number, active: boolean) {
  db().prepare(`UPDATE accounts SET is_active = ? WHERE id = ?`).run(active ? 1 : 0, accountId);
  updateTag("accounts");
  return { ok: true as const };
}
