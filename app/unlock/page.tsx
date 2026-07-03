"use client";

import { useState, useTransition } from "react";
import { unlockAction } from "@/lib/actions/auth";

export default function UnlockPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-80 rounded-xl border border-edge bg-surface p-6 text-center">
        <p className="mb-1 text-sm font-bold">
          statement<span className="text-accent">·</span>sorter
        </p>
        <p className="mb-4 text-xs text-ink-muted">Locked — enter your passphrase</p>
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await unlockAction(fd);
              if (res && !res.ok) setError(res.error ?? "Wrong passphrase.");
            })
          }
          className="space-y-2"
        >
          <input
            type="password"
            name="passphrase"
            autoFocus
            className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm"
            placeholder="Passphrase"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {pending ? "Checking…" : "Unlock"}
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
