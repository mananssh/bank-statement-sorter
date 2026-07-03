import type { Database } from "better-sqlite3";

/**
 * Default taxonomy + heuristic seed rules for fresh databases. Everything here
 * is ordinary editable data — seeds exist so a brand-new user gets sensible
 * auto-tagging out of the box, not to encode any one person's finances.
 * Seed rules sit at priority >= 900 so user rules always win.
 */

const DEFAULT_CATEGORIES: Array<{ name: string; type: string; sort: number }> = [
  { name: "Salary", type: "income", sort: 10 },
  { name: "Professional Fees", type: "income", sort: 20 },
  { name: "Interest Income", type: "income", sort: 30 },
  { name: "Dividend Income", type: "income", sort: 40 },
  { name: "Refunds", type: "income", sort: 50 },
  { name: "Other Income", type: "income", sort: 60 },
  { name: "Food & Groceries", type: "expense", sort: 110 },
  { name: "Rent & Housing", type: "expense", sort: 120 },
  { name: "Travel", type: "expense", sort: 130 },
  { name: "Subscriptions", type: "expense", sort: 140 },
  { name: "Medical", type: "expense", sort: 150 },
  { name: "Shopping", type: "expense", sort: 160 },
  { name: "Bank Charges", type: "expense", sort: 170 },
  { name: "Cash Withdrawal", type: "expense", sort: 180 },
  { name: "Personal Expenses", type: "expense", sort: 190 },
  { name: "Investments", type: "investment", sort: 210 },
  { name: "Fixed Deposit", type: "investment", sort: 220 },
  { name: "Credit Card Payment", type: "transfer", sort: 310 },
  { name: "Self Transfer", type: "transfer", sort: 320 },
];

interface SeedRule {
  category: string;
  field: "narration" | "counterparty" | "vpa" | "ref_number" | "channel";
  match: "exact" | "contains" | "prefix" | "regex";
  pattern: string;
  direction?: "debit" | "credit";
  priority: number;
}

const SEED_RULES: SeedRule[] = [
  { category: "Interest Income", field: "narration", match: "regex", pattern: "^INT(EREST)?\\b|INTEREST (PAID|CREDIT)", direction: "credit", priority: 900 },
  { category: "Cash Withdrawal", field: "channel", match: "exact", pattern: "atm", direction: "debit", priority: 900 },
  { category: "Bank Charges", field: "channel", match: "exact", pattern: "fee", priority: 910 },
  { category: "Investments", field: "narration", match: "regex", pattern: "\\b(ICCL|INDIAN CLEARING CORP|BSE ?STAR|NSE ?CLEARING|MUTUAL FUND|GROWW|ZERODHA|COIN DCX)\\b", direction: "debit", priority: 905 },
  { category: "Fixed Deposit", field: "channel", match: "exact", pattern: "fd", direction: "debit", priority: 910 },
  { category: "Credit Card Payment", field: "narration", match: "regex", pattern: "\\b(CRED\\b|CC ?PAYMENT|CREDIT CARD|CARD PAYMENT|BILLDESK.*CARD)\\b", direction: "debit", priority: 905 },
  { category: "Salary", field: "narration", match: "regex", pattern: "\\bSALARY\\b", direction: "credit", priority: 910 },
  { category: "Subscriptions", field: "narration", match: "regex", pattern: "\\b(NETFLIX|SPOTIFY|GOOGLE PLAY|YOUTUBE ?PREMIUM|PRIME VIDEO|APPLE\\.COM)\\b", direction: "debit", priority: 915 },
];

export function ensureSeedData(db: Database): void {
  const insertCategory = db.prepare(
    `INSERT INTO categories (name, type, sort_order) VALUES (?, ?, ?)
     ON CONFLICT(name) DO NOTHING`,
  );
  for (const c of DEFAULT_CATEGORIES) insertCategory.run(c.name, c.type, c.sort);

  const categoryId = db.prepare("SELECT id FROM categories WHERE name = ?");
  // NULLs are distinct in SQLite UNIQUE constraints, so ON CONFLICT can't
  // dedupe rules with NULL account_id/direction — guard with NOT EXISTS.
  const insertRule = db.prepare(
    `INSERT INTO categorization_rules
       (category_id, field, match_type, pattern, direction, priority, auto_created)
     SELECT @category_id, @field, @match_type, @pattern, @direction, @priority, 1
     WHERE NOT EXISTS (
       SELECT 1 FROM categorization_rules
       WHERE field = @field AND match_type = @match_type AND pattern = @pattern
     )`,
  );
  for (const r of SEED_RULES) {
    const cat = categoryId.get(r.category) as { id: number } | undefined;
    if (cat) {
      insertRule.run({
        category_id: cat.id,
        field: r.field,
        match_type: r.match,
        pattern: r.pattern,
        direction: r.direction ?? null,
        priority: r.priority,
      });
    }
  }
}
