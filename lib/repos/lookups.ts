import "server-only";
import { db } from "@/lib/db/client";
import type {
  AccountRow,
  CategoryRow,
  ImportPresetRow,
  PartyRow,
  RuleRow,
} from "@/lib/db/types";

export function listAccounts(includeInactive = false): AccountRow[] {
  return db()
    .prepare(
      `SELECT * FROM accounts ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`,
    )
    .all() as AccountRow[];
}

export function getAccount(id: number): AccountRow | undefined {
  return db().prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as AccountRow | undefined;
}

export function listCategories(includeInactive = false): CategoryRow[] {
  return db()
    .prepare(
      `SELECT * FROM categories ${includeInactive ? "" : "WHERE is_active = 1"}
       ORDER BY sort_order, name`,
    )
    .all() as CategoryRow[];
}

export function listParties(): Array<PartyRow & { txn_count: number; aliases: string }> {
  return db()
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM transactions t WHERE t.party_id = p.id) AS txn_count,
              (SELECT GROUP_CONCAT(alias_key, ', ') FROM party_aliases a WHERE a.party_id = p.id) AS aliases
       FROM parties p ORDER BY p.canonical_name`,
    )
    .all() as Array<PartyRow & { txn_count: number; aliases: string }>;
}

export function listPresets(): ImportPresetRow[] {
  return db().prepare(`SELECT * FROM import_presets ORDER BY name`).all() as ImportPresetRow[];
}

export function getPreset(id: number): ImportPresetRow | undefined {
  return db().prepare(`SELECT * FROM import_presets WHERE id = ?`).get(id) as
    | ImportPresetRow
    | undefined;
}

export function listRules(): Array<RuleRow & { category_name: string }> {
  return db()
    .prepare(
      `SELECT r.*, c.name AS category_name
       FROM categorization_rules r JOIN categories c ON c.id = r.category_id
       ORDER BY r.priority, r.id`,
    )
    .all() as Array<RuleRow & { category_name: string }>;
}

/** Distinct FY start years present in the data, newest first. */
export function listFyYears(): number[] {
  const rows = db()
    .prepare(`SELECT DISTINCT fy_start_year AS y FROM transactions ORDER BY y DESC`)
    .all() as Array<{ y: number }>;
  return rows.map((r) => r.y);
}
