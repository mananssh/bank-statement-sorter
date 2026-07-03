"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { parseAmountToPaise } from "@/lib/domain/money";

const invoiceSchema = z.object({
  invoice_no: z.string().min(1).max(40),
  client: z.string().min(1).max(120),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().min(1).max(8).default("INR"),
  amount: z.string().min(1),
  conversion_rate: z.coerce.number().positive().default(1),
});

export async function createInvoiceAction(formData: FormData) {
  const parsed = invoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false as const, error: "Check the invoice details." };
  const amountMinor = parseAmountToPaise(parsed.data.amount);
  if (!amountMinor) return { ok: false as const, error: "Invalid amount." };
  const amountInr =
    parsed.data.currency === "INR"
      ? amountMinor
      : Math.round(amountMinor * parsed.data.conversion_rate);
  try {
    db()
      .prepare(
        `INSERT INTO invoices (invoice_no, client, issue_date, currency, amount_minor,
           conversion_rate, amount_inr_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.invoice_no,
        parsed.data.client,
        parsed.data.issue_date,
        parsed.data.currency,
        amountMinor,
        parsed.data.conversion_rate,
        amountInr,
      );
    updateTag("invoices");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "That invoice number already exists." };
  }
}

export async function markInvoicePaidAction(invoiceId: number, txnId: number | null) {
  db()
    .prepare(`UPDATE invoices SET status = 'paid', paid_txn_id = ? WHERE id = ?`)
    .run(txnId, invoiceId);
  updateTag("invoices");
  return { ok: true as const };
}

export async function updateInvoiceStatusAction(
  invoiceId: number,
  status: "draft" | "sent" | "void",
) {
  db()
    .prepare(`UPDATE invoices SET status = ?, paid_txn_id = NULL WHERE id = ?`)
    .run(status, invoiceId);
  updateTag("invoices");
  return { ok: true as const };
}
