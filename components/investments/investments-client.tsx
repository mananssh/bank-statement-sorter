"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createFdAction,
  deleteFdAction,
  updateFdAction,
  updateFdStatusAction,
  updateNavAction,
  updateSipBudgetAction,
} from "@/lib/actions/investments";
import { Button, Card, CardTitle, Input, Td } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import type { FixedDepositRow } from "@/lib/db/types";

export function NavEditor({ fundId, lastNav }: { fundId: number; lastNav: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await updateNavAction(fundId, fd);
          router.refresh();
        })
      }
      className="flex items-center gap-1"
    >
      <Input
        name="nav"
        defaultValue={lastNav ?? ""}
        placeholder="NAV"
        className="w-20 py-0.5 text-xs"
        inputMode="decimal"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded px-1 text-xs text-accent hover:bg-accent/10"
        title="Save today's NAV"
      >
        ✓
      </button>
    </form>
  );
}

export function SipBudgetForm({ budgetPaise }: { budgetPaise: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await updateSipBudgetAction(fd);
          router.refresh();
        })
      }
      className="flex items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        Monthly investing budget (₹)
        <Input
          name="budget"
          defaultValue={budgetPaise !== null ? budgetPaise / 100 : ""}
          className="w-28"
          inputMode="decimal"
        />
      </label>
      <Button variant="ghost" type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function FdForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardTitle>Add fixed deposit</CardTitle>
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            const res = await createFdAction(fd);
            if (!res.ok) setError(res.error ?? "Failed.");
            else router.refresh();
          })
        }
        className="flex flex-wrap items-end gap-2"
      >
        <Field label="FD number (last digits ok)">
          <Input name="fd_number" required className="w-32" />
        </Field>
        <Field label="Principal (₹)">
          <Input name="principal" required className="w-28" inputMode="decimal" />
        </Field>
        <Field label="Rate % p.a.">
          <Input name="rate_pct" required className="w-20" inputMode="decimal" />
        </Field>
        <Field label="Start date">
          <Input name="start_date" type="date" required />
        </Field>
        <Field label="Maturity date">
          <Input name="maturity_date" type="date" required />
        </Field>
        <Field label="Maturity amount (₹, optional)">
          <Input name="maturity_amount" className="w-28" inputMode="decimal" />
        </Field>
        <Button type="submit" disabled={pending}>
          Add FD
        </Button>
      </form>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </Card>
  );
}

export function FdStatusButton({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = status === "active" ? "matured" : status === "matured" ? "closed" : "active";
  return (
    <button
      disabled={pending}
      className="text-xs text-accent hover:underline"
      onClick={() =>
        startTransition(async () => {
          await updateFdStatusAction(id, next as "active" | "matured" | "closed");
          router.refresh();
        })
      }
    >
      {status} → {next}
    </button>
  );
}

/** One FD row: normal display, or an inline edit form when "Edit" is clicked. */
export function FdRow({ fd }: { fd: FixedDepositRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <tr>
        <td colSpan={6} className="border-b border-hairline/60 px-3 py-2">
          <form
            action={(formData) =>
              startTransition(async () => {
                setError(null);
                const res = await updateFdAction(fd.id, formData);
                if (!res.ok) setError(res.error ?? "Failed.");
                else {
                  setEditing(false);
                  router.refresh();
                }
              })
            }
            className="flex flex-wrap items-end gap-2"
          >
            <Field label="FD number">
              <Input name="fd_number" defaultValue={fd.fd_number} required className="w-32" />
            </Field>
            <Field label="Principal (₹)">
              <Input
                name="principal"
                defaultValue={fd.principal_paise / 100}
                required
                className="w-28"
                inputMode="decimal"
              />
            </Field>
            <Field label="Rate % p.a.">
              <Input
                name="rate_pct"
                defaultValue={fd.interest_rate_bp / 100}
                required
                className="w-20"
                inputMode="decimal"
              />
            </Field>
            <Field label="Start date">
              <Input name="start_date" type="date" defaultValue={fd.start_date} required />
            </Field>
            <Field label="Maturity date">
              <Input name="maturity_date" type="date" defaultValue={fd.maturity_date} required />
            </Field>
            <Field label="Maturity amount (₹, optional)">
              <Input
                name="maturity_amount"
                defaultValue={fd.maturity_amount_paise !== null ? fd.maturity_amount_paise / 100 : ""}
                className="w-28"
                inputMode="decimal"
              />
            </Field>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
          {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </td>
      </tr>
    );
  }

  return (
    <tr className={fd.status !== "active" ? "opacity-50" : ""}>
      <Td className="font-medium tnum">…{fd.fd_number.slice(-6)}</Td>
      <Td className="text-right tnum">{formatPaise(fd.principal_paise)}</Td>
      <Td className="text-right tnum">{(fd.interest_rate_bp / 100).toFixed(2)}%</Td>
      <Td className="tnum">{fd.maturity_date}</Td>
      <Td>
        <FdStatusButton id={fd.id} status={fd.status} />
      </Td>
      <Td>
        <div className="flex items-center gap-2 text-xs">
          <button
            className="text-accent hover:underline"
            onClick={() => setEditing(true)}
            disabled={pending}
          >
            edit
          </button>
          {confirmingDelete ? (
            <>
              <button
                className="font-medium text-danger hover:underline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteFdAction(fd.id);
                    router.refresh();
                  })
                }
              >
                confirm?
              </button>
              <button className="text-ink-muted hover:underline" onClick={() => setConfirmingDelete(false)}>
                cancel
              </button>
            </>
          ) : (
            <button className="text-danger hover:underline" onClick={() => setConfirmingDelete(true)}>
              delete
            </button>
          )}
        </div>
      </Td>
    </tr>
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
