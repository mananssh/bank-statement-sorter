import "server-only";
import type { Database } from "better-sqlite3";
import type { Direction, RuleRow } from "@/lib/db/types";
import { payeeKey } from "@/lib/categorize/keys";

export interface Suggestion {
  category_id: number | null;
  party_id: number | null;
  source: "memory" | "party_default" | "rule" | "seed" | null;
  confidence: number;
  rule_id?: number;
}

export interface ResolvableTxn {
  account_id: number;
  narration: string;
  ref_number?: string | null;
  direction: Direction;
  amount_paise: number;
  channel?: string | null;
  counterparty_raw?: string | null;
  counterparty_vpa?: string | null;
}

const NONE: Suggestion = { category_id: null, party_id: null, source: null, confidence: 0 };

/**
 * Layered category+party resolution, first hit wins:
 *   1. narration memory (exact payee-key match, learned from confirmed txns)
 *   2. party default category (via party_aliases)
 *   3. user rules by ascending priority (seed rules ship at priority 900+)
 *   4. untagged
 */
export function resolve(db: Database, txn: ResolvableTxn): Suggestion {
  const key = payeeKey(txn);

  // Party via alias — used by layers 1-2 and attached to any result.
  const party = key
    ? (db
        .prepare(
          `SELECT p.id, p.default_category_id FROM party_aliases a
           JOIN parties p ON p.id = a.party_id WHERE a.alias_key = ?`,
        )
        .get(key) as { id: number; default_category_id: number | null } | undefined)
    : undefined;

  if (key) {
    const memory = db
      .prepare(
        `SELECT category_id, party_id, hit_count FROM narration_memory
         WHERE key = ? AND account_id IN (0, ?) ORDER BY account_id DESC LIMIT 1`,
      )
      .get(key, txn.account_id) as
      | { category_id: number; party_id: number | null; hit_count: number }
      | undefined;
    if (memory) {
      return {
        category_id: memory.category_id,
        party_id: memory.party_id ?? party?.id ?? null,
        source: "memory",
        confidence: memory.hit_count >= 2 ? 0.95 : 0.8,
      };
    }
  }

  if (party?.default_category_id) {
    return {
      category_id: party.default_category_id,
      party_id: party.id,
      source: "party_default",
      confidence: 0.9,
    };
  }

  const rules = db
    .prepare(
      `SELECT * FROM categorization_rules
       WHERE is_active = 1 AND (account_id IS NULL OR account_id = ?)
       ORDER BY priority ASC, id ASC`,
    )
    .all(txn.account_id) as RuleRow[];

  for (const rule of rules) {
    if (!ruleMatches(rule, txn)) continue;
    return {
      category_id: rule.category_id,
      party_id: rule.party_id ?? party?.id ?? null,
      source: rule.priority >= 900 ? "seed" : "rule",
      confidence: rule.priority >= 900 ? 0.7 : 0.85,
      rule_id: rule.id,
    };
  }

  return { ...NONE, party_id: party?.id ?? null };
}

function ruleMatches(rule: RuleRow, txn: ResolvableTxn): boolean {
  if (rule.direction && rule.direction !== txn.direction) return false;
  if (rule.amount_min_paise !== null && txn.amount_paise < rule.amount_min_paise) return false;
  if (rule.amount_max_paise !== null && txn.amount_paise > rule.amount_max_paise) return false;

  const value = fieldValue(rule.field, txn);
  if (value === null) return false;
  const v = value.toLowerCase();
  const p = rule.pattern.toLowerCase();

  switch (rule.match_type) {
    case "exact":
      return v === p;
    case "contains":
      return v.includes(p);
    case "prefix":
      return v.startsWith(p);
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(value);
      } catch {
        return false;
      }
  }
}

function fieldValue(field: RuleRow["field"], txn: ResolvableTxn): string | null {
  switch (field) {
    case "narration":
      return txn.narration || null;
    case "counterparty":
      return txn.counterparty_raw ?? null;
    case "vpa":
      return txn.counterparty_vpa ?? null;
    case "ref_number":
      return txn.ref_number ?? null;
    case "channel":
      return txn.channel ?? null;
  }
}
