"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";

/**
 * Goal mutations. A goal is just (name, start_date, sip_share_pct) — the whole
 * per-goal ledger derives from those on read, so there is nothing to
 * recalculate or backfill after a write.
 */

const goalSchema = z.object({
  name: z.string().trim().min(1).max(60),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
  share_pct: z.coerce.number().min(0).max(100),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Goals have no end date, so every goal is eventually active at the same time
 * and the steady-state claim on each purchase is simply the sum of all shares.
 * Keeping that under 100% is what guarantees units are never over-claimed.
 */
function shareHeadroom(excludeId: number | null): number {
  const rows = db()
    .prepare(`SELECT id, sip_share_pct FROM goals WHERE is_archived = 0`)
    .all() as Array<{ id: number; sip_share_pct: number }>;
  const used = rows
    .filter((r) => r.id !== excludeId)
    .reduce((sum, r) => sum + r.sip_share_pct, 0);
  return 100 - used;
}

export async function createGoalAction(formData: FormData) {
  const parsed = goalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the goal." };
  }
  const headroom = shareHeadroom(null);
  if (parsed.data.share_pct > headroom + 0.01) {
    return {
      ok: false as const,
      error: `Only ${headroom.toFixed(1)}% of each SIP is unclaimed — lower the share or reduce another goal.`,
    };
  }
  try {
    db()
      .prepare(
        `INSERT INTO goals (name, start_date, sip_share_pct, notes) VALUES (?, ?, ?, ?)`,
      )
      .run(
        parsed.data.name,
        parsed.data.start_date,
        parsed.data.share_pct,
        parsed.data.notes || null,
      );
    updateTag("investments");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "A goal with that name already exists." };
  }
}

export async function updateGoalAction(id: number, formData: FormData) {
  const parsed = goalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the goal." };
  }
  const headroom = shareHeadroom(id);
  if (parsed.data.share_pct > headroom + 0.01) {
    return {
      ok: false as const,
      error: `Only ${headroom.toFixed(1)}% of each SIP is unclaimed by other goals.`,
    };
  }
  try {
    db()
      .prepare(
        `UPDATE goals SET name = ?, start_date = ?, sip_share_pct = ?, notes = ? WHERE id = ?`,
      )
      .run(
        parsed.data.name,
        parsed.data.start_date,
        parsed.data.share_pct,
        parsed.data.notes || null,
        id,
      );
    updateTag("investments");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "A goal with that name already exists." };
  }
}

/**
 * Split the unclaimed remainder equally across every active goal — the "fair
 * ratio" default. Each goal then holds the same proportional slice of every
 * instrument, so goals running over the same window earn identical per-rupee
 * returns.
 */
export async function equalizeGoalSharesAction() {
  const conn = db();
  const rows = conn
    .prepare(`SELECT id FROM goals WHERE is_archived = 0 ORDER BY start_date, name`)
    .all() as Array<{ id: number }>;
  if (rows.length === 0) return { ok: false as const, error: "No active goals to split." };

  // Distribute to 2dp and give the residual to the first goal so the shares
  // total exactly 100% instead of 99.99%.
  const each = Math.floor((100 / rows.length) * 100) / 100;
  const residual = Math.round((100 - each * rows.length) * 100) / 100;
  const update = conn.prepare(`UPDATE goals SET sip_share_pct = ? WHERE id = ?`);
  const tx = conn.transaction(() => {
    rows.forEach((r, i) => update.run(i === 0 ? each + residual : each, r.id));
  });
  tx();
  updateTag("investments");
  return { ok: true as const };
}

export async function setGoalArchivedAction(id: number, archived: boolean) {
  db()
    .prepare(`UPDATE goals SET is_archived = ? WHERE id = ?`)
    .run(archived ? 1 : 0, id);
  updateTag("investments");
  return { ok: true as const };
}

export async function deleteGoalAction(id: number) {
  db().prepare(`DELETE FROM goals WHERE id = ?`).run(id);
  updateTag("investments");
  return { ok: true as const };
}
