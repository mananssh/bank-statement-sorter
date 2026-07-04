"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addInvestmentTxnAction,
  addValuationAction,
} from "@/lib/actions/investments";
import { Button, Card, CardTitle, Input, Select } from "@/components/ui";

/** Inline current-value editor for balance-based instruments (PPF/EPF/NPS). */
export function ValuationEditor({
  fundId,
  valuePaise,
}: {
  fundId: number;
  valuePaise: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await addValuationAction(fundId, fd);
          router.refresh();
        })
      }
      className="flex items-center gap-1"
    >
      <Input
        name="value"
        defaultValue={valuePaise !== null ? (valuePaise / 100).toFixed(2) : ""}
        placeholder="Balance ₹"
        className="w-28 py-0.5 text-right text-xs tnum"
        inputMode="decimal"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded px-1 text-xs text-accent hover:bg-accent/10"
        title="Save today's balance"
      >
        ✓
      </button>
    </form>
  );
}

/** Manual transaction entry — PPF/EPF contributions, off-platform buys, dividends. */
export function AddTxnForm({ funds }: { funds: Array<{ id: number; name: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card>
      <CardTitle>Add a transaction manually</CardTitle>
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            setSaved(false);
            const res = await addInvestmentTxnAction(fd);
            if (!res.ok) setError(res.error ?? "Could not save.");
            else {
              setSaved(true);
              router.refresh();
            }
          })
        }
        className="grid grid-cols-2 gap-2 md:grid-cols-6"
      >
        <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Instrument
          <Select name="fund_id" required>
            <option value="">Choose…</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Date
          <Input name="txn_date" type="date" required className="py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Type
          <Select name="txn_type" defaultValue="lumpsum">
            <option value="sip">SIP</option>
            <option value="lumpsum">Lumpsum / contribution</option>
            <option value="sell">Sell / redeem</option>
            <option value="dividend">Dividend / payout</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Amount (₹)
          <Input name="amount" required inputMode="decimal" placeholder="5000" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Units <span className="font-normal text-ink-muted">(optional)</span>
          <Input name="units" inputMode="decimal" placeholder="—" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          NAV <span className="font-normal text-ink-muted">(optional)</span>
          <Input name="nav" inputMode="decimal" placeholder="—" />
        </label>
        <div className="col-span-2 flex items-end gap-3 md:col-span-6">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add transaction"}
          </Button>
          {saved ? <span className="text-sm text-success">Saved ✓</span> : null}
          {error ? <span className="text-sm text-danger">{error}</span> : null}
        </div>
      </form>
    </Card>
  );
}
