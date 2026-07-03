"use client";

import { useState, useTransition } from "react";
import { updateSettingsAction } from "@/lib/actions/settings";
import {
  clearPassphraseAction,
  lockNowAction,
  setPassphraseAction,
} from "@/lib/actions/auth";
import { Button, Card, CardTitle, Input, Select } from "@/components/ui";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function GeneralSettingsForm({
  fyStartMonth,
  currency,
}: {
  fyStartMonth: number;
  currency: string;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Card>
      <CardTitle>General</CardTitle>
      <form
        action={(fd) =>
          startTransition(async () => {
            const res = await updateSettingsAction(fd);
            setMsg(res.ok ? "Saved." : (res.error ?? "Failed."));
          })
        }
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Financial year starts in
          <Select name="fy_start_month" defaultValue={fyStartMonth}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Currency
          <Input name="currency" defaultValue={currency} className="w-24" />
        </label>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        {msg ? <span className="text-sm text-ink-secondary">{msg}</span> : null}
      </form>
      <p className="mt-2 text-xs text-ink-muted">
        April = Indian FY (Apr–Mar). January = calendar year.
      </p>
    </Card>
  );
}

export function PassphraseForm({ isSet }: { isSet: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Card>
      <CardTitle>App passphrase</CardTitle>
      <p className="mb-3 text-sm text-ink-secondary">
        {isSet
          ? "A passphrase is set — every visit needs an unlock. "
          : "Optional: require a passphrase to open the app. Recommended on shared machines. "}
        This protects the UI; enable OS disk encryption (e.g. BitLocker) to protect the data files
        at rest.
      </p>
      <form
        action={(fd) =>
          startTransition(async () => {
            const res = await setPassphraseAction(fd);
            setMsg(res.ok ? "Passphrase updated." : (res.error ?? "Failed."));
          })
        }
        className="flex flex-wrap items-end gap-2"
      >
        {isSet ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Current
            <Input type="password" name="current" />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          New passphrase
          <Input type="password" name="next" minLength={6} />
        </label>
        <Button type="submit" disabled={pending}>
          {isSet ? "Change" : "Enable"}
        </Button>
      </form>
      {isSet ? (
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await clearPassphraseAction(fd);
              setMsg(res.ok ? "Passphrase removed." : (res.error ?? "Failed."));
            })
          }
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Current
            <Input type="password" name="current" />
          </label>
          <Button variant="danger" type="submit" disabled={pending}>
            Remove passphrase
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => startTransition(async () => void (await lockNowAction()))}
          >
            Lock now
          </Button>
        </form>
      ) : null}
      {msg ? <p className="mt-2 text-sm text-ink-secondary">{msg}</p> : null}
    </Card>
  );
}
