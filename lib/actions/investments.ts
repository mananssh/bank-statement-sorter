"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { fyStartMonth, setSetting } from "@/lib/repos/settings";
import { parseAmountToPaise } from "@/lib/domain/money";
import { fyStartYear } from "@/lib/domain/fy";
import { createInstrument } from "@/lib/import/instruments";

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

/** Manual current value — the valuation source for PPF/EPF/NPS and overrides. */
export async function addValuationAction(fundId: number, formData: FormData) {
  const value = parseAmountToPaise(String(formData.get("value") ?? ""));
  if (value === null) return { ok: false as const, error: "Invalid value." };
  const date =
    String(formData.get("date") ?? "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ??
    new Date().toISOString().slice(0, 10);
  db()
    .prepare(
      `INSERT INTO instrument_valuations (fund_id, val_date, value_paise) VALUES (?, ?, ?)
       ON CONFLICT(fund_id, val_date) DO UPDATE SET value_paise = excluded.value_paise`,
    )
    .run(fundId, date, value);
  updateTag("investments");
  return { ok: true as const };
}

const manualTxnSchema = z.object({
  fund_id: z.coerce.number().int().positive(),
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  txn_type: z.enum(["sip", "lumpsum", "sell", "dividend"]),
  amount: z.string().min(1),
  units: z.string().optional(),
  nav: z.string().optional(),
});

/** Manual entry — PPF/EPF contributions, off-platform buys, dividends. */
export async function addInvestmentTxnAction(formData: FormData) {
  const parsed = manualTxnSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false as const, error: "Check the transaction details." };
  const amount = parseAmountToPaise(parsed.data.amount);
  if (!amount) return { ok: false as const, error: "Invalid amount." };
  const units = parsed.data.units ? Number(parsed.data.units.replace(/,/g, "")) || null : null;
  const nav = parsed.data.nav ? Number(parsed.data.nav.replace(/,/g, "")) || null : null;
  db()
    .prepare(
      `INSERT INTO investment_txns
         (fund_id, txn_date, txn_type, amount_paise, nav, units, fy_start_year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parsed.data.fund_id,
      parsed.data.txn_date,
      parsed.data.txn_type,
      amount,
      nav,
      units,
      fyStartYear(parsed.data.txn_date, fyStartMonth()),
    );
  if (nav) {
    db()
      .prepare(
        `INSERT INTO fund_navs (fund_id, nav_date, nav) VALUES (?, ?, ?)
         ON CONFLICT(fund_id, nav_date) DO UPDATE SET nav = excluded.nav`,
      )
      .run(parsed.data.fund_id, parsed.data.txn_date, nav);
  }
  updateTag("investments");
  return { ok: true as const };
}

const newInstrumentSchema = z.object({
  name: z.string().min(1).max(200),
  instrument_kind: z.enum(["mutual_fund", "stock", "etf", "ppf", "epf", "nps", "bond", "other"]),
  asset_class: z.enum(["equity", "debt", "gold", "elss", "hybrid", "other"]),
  sub_category: z.string().max(60).optional(),
  is_elss: z.coerce.boolean().optional(),
  isin: z.string().max(20).optional(),
});

export async function addInstrumentAction(formData: FormData) {
  const parsed = newInstrumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false as const, error: "Check the instrument details." };
  try {
    const id = createInstrument(db(), {
      name: parsed.data.name,
      instrument_kind: parsed.data.instrument_kind,
      asset_class: parsed.data.asset_class,
      sub_category: parsed.data.sub_category || null,
      is_elss: Boolean(parsed.data.is_elss),
      isin: parsed.data.isin || null,
      platform: null,
    });
    updateTag("investments");
    return { ok: true as const, id };
  } catch {
    return { ok: false as const, error: "An instrument with that name already exists." };
  }
}

/** Per-instrument SIP plan fields used by the target builder splits. */
export async function updateFundSipAction(
  fundId: number,
  patch: { is_sip_active?: boolean; sip_amount?: string; sip_weight?: number },
) {
  if ("is_sip_active" in patch) {
    db()
      .prepare(`UPDATE funds SET is_sip_active = ? WHERE id = ?`)
      .run(patch.is_sip_active ? 1 : 0, fundId);
  }
  if ("sip_amount" in patch) {
    const paise = patch.sip_amount ? parseAmountToPaise(patch.sip_amount) : null;
    db().prepare(`UPDATE funds SET sip_amount_paise = ? WHERE id = ?`).run(paise, fundId);
  }
  if (patch.sip_weight !== undefined && Number.isFinite(patch.sip_weight) && patch.sip_weight >= 0) {
    db().prepare(`UPDATE funds SET sip_weight = ? WHERE id = ?`).run(patch.sip_weight, fundId);
  }
  updateTag("investments");
  return { ok: true as const };
}

const targetsSchema = z.array(
  z.object({
    asset_class: z.enum(["equity", "debt", "gold", "elss", "hybrid", "other"]),
    sub_category: z.string().max(60),
    target_pct: z.number().min(0).max(100),
  }),
);

export async function toggleAmfiAction(enabled: boolean) {
  setSetting("amfi_enabled", enabled);
  updateTag("investments");
  return { ok: true as const };
}

export async function fetchAmfiNavsAction() {
  try {
    const { fetchAmfiNavs } = await import("@/lib/integrations/amfi");
    const result = await fetchAmfiNavs();
    updateTag("investments");
    return { ok: true as const, result };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "NAV fetch failed.",
    };
  }
}

/** Replace the whole allocation-target tree (tier-1 rows use sub_category ''). */
export async function saveAllocationTargetsAction(targets: unknown) {
  const parsed = targetsSchema.safeParse(targets);
  if (!parsed.success) return { ok: false as const, error: "Invalid targets." };
  const tier1 = parsed.data.filter((t) => t.sub_category === "");
  const tier1Sum = tier1.reduce((s, t) => s + t.target_pct, 0);
  if (tier1.length > 0 && Math.abs(tier1Sum - 100) > 0.01) {
    return { ok: false as const, error: `Asset-class targets add up to ${tier1Sum}%, not 100%.` };
  }
  const conn = db();
  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM allocation_targets`).run();
    const insert = conn.prepare(
      `INSERT INTO allocation_targets (asset_class, sub_category, target_pct) VALUES (?, ?, ?)`,
    );
    for (const t of parsed.data) {
      if (t.target_pct > 0) insert.run(t.asset_class, t.sub_category, t.target_pct);
    }
  });
  tx();
  updateTag("investments");
  return { ok: true as const };
}
