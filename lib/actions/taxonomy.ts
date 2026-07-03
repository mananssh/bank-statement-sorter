"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";

// Categories -----------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(["income", "expense", "investment", "transfer"]),
  notes: z.string().max(200).optional(),
});

export async function createCategoryAction(input: unknown) {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid category." };
  try {
    const res = db()
      .prepare(`INSERT INTO categories (name, type, notes) VALUES (?, ?, ?)`)
      .run(parsed.data.name, parsed.data.type, parsed.data.notes ?? null);
    updateTag("lookups");
    return { ok: true as const, id: Number(res.lastInsertRowid) };
  } catch {
    return { ok: false as const, error: "That category already exists." };
  }
}

export async function toggleCategoryAction(id: number, active: boolean) {
  db().prepare(`UPDATE categories SET is_active = ? WHERE id = ?`).run(active ? 1 : 0, id);
  updateTag("lookups");
  return { ok: true as const };
}

export async function deleteCategoryAction(id: number) {
  const used = db()
    .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?`)
    .get(id) as { n: number };
  if (used.n > 0) {
    return {
      ok: false as const,
      error: `${used.n} transaction(s) use this category — deactivate it instead.`,
    };
  }
  db().prepare(`DELETE FROM categories WHERE id = ?`).run(id);
  updateTag("lookups");
  return { ok: true as const };
}

// Parties ---------------------------------------------------------------------

export async function updatePartyAction(
  id: number,
  patch: { canonical_name?: string; default_category_id?: number | null },
) {
  if (patch.canonical_name !== undefined) {
    db()
      .prepare(`UPDATE parties SET canonical_name = ? WHERE id = ?`)
      .run(patch.canonical_name, id);
  }
  if (patch.default_category_id !== undefined) {
    db()
      .prepare(`UPDATE parties SET default_category_id = ? WHERE id = ?`)
      .run(patch.default_category_id, id);
  }
  updateTag("lookups");
  return { ok: true as const };
}

/** Merge source party into target: moves aliases + transactions, deletes source. */
export async function mergePartiesAction(sourceId: number, targetId: number) {
  if (sourceId === targetId) return { ok: false as const, error: "Pick two different parties." };
  const conn = db();
  const tx = conn.transaction(() => {
    conn.prepare(`UPDATE party_aliases SET party_id = ? WHERE party_id = ?`).run(targetId, sourceId);
    conn.prepare(`UPDATE transactions SET party_id = ? WHERE party_id = ?`).run(targetId, sourceId);
    conn.prepare(`UPDATE narration_memory SET party_id = ? WHERE party_id = ?`).run(targetId, sourceId);
    conn.prepare(`DELETE FROM parties WHERE id = ?`).run(sourceId);
  });
  tx();
  updateTag("lookups");
  updateTag("txns");
  return { ok: true as const };
}

// Rules -----------------------------------------------------------------------

const ruleSchema = z.object({
  category_id: z.number().int().positive(),
  field: z.enum(["narration", "counterparty", "vpa", "ref_number", "channel"]),
  match_type: z.enum(["exact", "contains", "prefix", "regex"]),
  pattern: z.string().min(1).max(300),
  direction: z.enum(["debit", "credit"]).nullable().optional(),
  priority: z.number().int().min(1).max(1000).default(100),
});

export async function createRuleAction(input: unknown) {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid rule." };
  if (parsed.data.match_type === "regex") {
    try {
      new RegExp(parsed.data.pattern);
    } catch {
      return { ok: false as const, error: "Invalid regular expression." };
    }
  }
  try {
    db()
      .prepare(
        `INSERT INTO categorization_rules (category_id, field, match_type, pattern, direction, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.category_id,
        parsed.data.field,
        parsed.data.match_type,
        parsed.data.pattern,
        parsed.data.direction ?? null,
        parsed.data.priority,
      );
    updateTag("lookups");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "An identical rule already exists." };
  }
}

export async function toggleRuleAction(id: number, active: boolean) {
  db().prepare(`UPDATE categorization_rules SET is_active = ? WHERE id = ?`).run(active ? 1 : 0, id);
  updateTag("lookups");
  return { ok: true as const };
}

export async function deleteRuleAction(id: number) {
  db().prepare(`DELETE FROM categorization_rules WHERE id = ?`).run(id);
  updateTag("lookups");
  return { ok: true as const };
}

/** Dry-run a rule against committed history — powers the "test rule" preview. */
export async function testRuleAction(input: unknown) {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid rule." };
  const { field, match_type, pattern, direction } = parsed.data;

  const column =
    field === "counterparty"
      ? "counterparty_raw"
      : field === "vpa"
        ? "counterparty_vpa"
        : field;

  let where: string;
  const params: unknown[] = [];
  switch (match_type) {
    case "exact":
      where = `LOWER(${column}) = LOWER(?)`;
      params.push(pattern);
      break;
    case "contains":
      where = `${column} LIKE '%' || ? || '%'`;
      params.push(pattern);
      break;
    case "prefix":
      where = `${column} LIKE ? || '%'`;
      params.push(pattern);
      break;
    case "regex":
      // SQLite has no regexp by default — filter in JS below.
      where = `${column} IS NOT NULL`;
      break;
  }
  if (direction) {
    where += ` AND direction = ?`;
    params.push(direction);
  }

  let rows = db()
    .prepare(
      `SELECT id, txn_date, narration, amount_paise, direction, ${column} AS matched_value
       FROM transactions WHERE ${where} ORDER BY txn_date DESC LIMIT 200`,
    )
    .all(...params) as Array<{
    id: number;
    txn_date: string;
    narration: string;
    amount_paise: number;
    direction: string;
    matched_value: string | null;
  }>;

  if (match_type === "regex") {
    try {
      const re = new RegExp(pattern, "i");
      rows = rows.filter((r) => r.matched_value && re.test(r.matched_value));
    } catch {
      return { ok: false as const, error: "Invalid regular expression." };
    }
  }

  return { ok: true as const, matches: rows.slice(0, 25), total: rows.length };
}
