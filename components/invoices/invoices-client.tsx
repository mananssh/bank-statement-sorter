"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createInvoiceAction,
  markInvoicePaidAction,
  updateInvoiceStatusAction,
} from "@/lib/actions/invoices";
import { Button, Card, CardTitle, Input, Select } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";

export function InvoiceForm({ nextNumber }: { nextNumber: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("INR");

  return (
    <Card>
      <CardTitle>Raise invoice</CardTitle>
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            const res = await createInvoiceAction(fd);
            if (!res.ok) setError(res.error ?? "Failed.");
            else router.refresh();
          })
        }
        className="flex flex-wrap items-end gap-2"
      >
        <Field label="Invoice no.">
          <Input name="invoice_no" defaultValue={nextNumber} required className="w-40" />
        </Field>
        <Field label="Bill to">
          <Input name="client" required className="w-48" />
        </Field>
        <Field label="Issue date">
          <Input name="issue_date" type="date" required defaultValue={today()} />
        </Field>
        <Field label="Currency">
          <Select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option>INR</option>
            <option>USD</option>
            <option>EUR</option>
            <option>GBP</option>
            <option>AED</option>
            <option>SGD</option>
          </Select>
        </Field>
        <Field label={`Amount (${currency})`}>
          <Input name="amount" required className="w-28" inputMode="decimal" />
        </Field>
        {currency !== "INR" ? (
          <Field label="Conversion rate → INR">
            <Input name="conversion_rate" required className="w-24" inputMode="decimal" />
          </Field>
        ) : null}
        <Button type="submit" disabled={pending}>
          Add
        </Button>
      </form>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </Card>
  );
}

export function PaidMatcher({
  invoiceId,
  candidates,
}: {
  invoiceId: number;
  candidates: Array<{ id: number; txn_date: string; narration: string; amount_paise: number }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {candidates.length === 0 ? (
        <button
          disabled={pending}
          className="rounded-md bg-success-bg px-2 py-0.5 text-xs font-medium text-success"
          onClick={() =>
            startTransition(async () => {
              await markInvoicePaidAction(invoiceId, null);
              router.refresh();
            })
          }
        >
          Mark paid
        </button>
      ) : (
        candidates.map((c) => (
          <button
            key={c.id}
            disabled={pending}
            title={c.narration}
            className="rounded-md bg-success-bg px-2 py-0.5 text-xs font-medium text-success"
            onClick={() =>
              startTransition(async () => {
                await markInvoicePaidAction(invoiceId, c.id);
                router.refresh();
              })
            }
          >
            Paid on {c.txn_date} ({formatPaise(c.amount_paise)}) ✓
          </button>
        ))
      )}
      <button
        disabled={pending}
        className="rounded-md bg-hairline/50 px-2 py-0.5 text-xs text-ink-secondary"
        onClick={() =>
          startTransition(async () => {
            await updateInvoiceStatusAction(invoiceId, "void");
            router.refresh();
          })
        }
      >
        Void
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
      {label}
      {children}
    </label>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
