"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { setSetting } from "@/lib/repos/settings";
import { parseAmountToPaise } from "@/lib/domain/money";

export async function updateNavAction(fundId: number, formData: FormData) {
  const nav = Number(formData.get("nav"));
  if (!Number.isFinite(nav) || nav <= 0) return { ok: false as const, error: "Invalid NAV." };
  const date = new Date().toISOString().slice(0, 10);
  db()
    .prepare(
      `INSERT INTO fund_navs (fund_id, nav_date, nav) VALUES (?, ?, ?)
       ON CONFLICT(fund_id, nav_date) DO UPDATE SET nav = excluded.nav`,
    )
    .run(fundId, date, nav);
  updateTag("investments");
  return { ok: true as const };
}

const fdSchema = z.object({
  fd_number: z.string().min(1).max(40),
  principal: z.string().min(1),
  rate_pct: z.coerce.number().min(0).max(30),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturity_amount: z.string().optional(),
});

export async function createFdAction(formData: FormData) {
  const parsed = fdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false as const, error: "Check the FD details." };
  const principal = parseAmountToPaise(parsed.data.principal);
  if (!principal) return { ok: false as const, error: "Invalid principal amount." };
  const maturityAmount = parsed.data.maturity_amount
    ? parseAmountToPaise(parsed.data.maturity_amount)
    : null;
  try {
    db()
      .prepare(
        `INSERT INTO fixed_deposits
           (fd_number, principal_paise, interest_rate_bp, start_date, maturity_date, maturity_amount_paise)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.fd_number,
        principal,
        Math.round(parsed.data.rate_pct * 100),
        parsed.data.start_date,
        parsed.data.maturity_date,
        maturityAmount,
      );
    updateTag("investments");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "An FD with that number already exists." };
  }
}

export async function updateFdStatusAction(id: number, status: "active" | "matured" | "closed") {
  db().prepare(`UPDATE fixed_deposits SET status = ? WHERE id = ?`).run(status, id);
  updateTag("investments");
  return { ok: true as const };
}

export async function updateSipBudgetAction(formData: FormData) {
  const budget = parseAmountToPaise(String(formData.get("budget") ?? ""));
  setSetting("sip_budget_paise", budget ?? null);
  updateTag("investments");
  return { ok: true as const };
}
