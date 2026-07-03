"use client";

import { useState, useTransition } from "react";
import { batchPasswordAction } from "@/lib/actions/import";
import { Button, Card, CardTitle, Input } from "@/components/ui";

export function PasswordForm({ batchId, lostSession }: { batchId: number; lostSession?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="max-w-md">
      <CardTitle>Workbook password</CardTitle>
      <p className="mb-3 text-sm text-ink-secondary">
        {lostSession
          ? "The app restarted, so the password needs to be entered again."
          : "This file is protected with an Excel password."}{" "}
        It is used once, in memory, to decrypt the file — never stored or logged.
      </p>
      <form
        action={(formData) =>
          startTransition(async () => {
            const res = await batchPasswordAction(batchId, formData);
            if (res && !res.ok) setError(res.error ?? "Could not decrypt.");
          })
        }
        className="flex gap-2"
      >
        <Input type="password" name="password" placeholder="Password" autoFocus className="flex-1" />
        <Button type="submit" disabled={pending}>
          {pending ? "Decrypting…" : "Unlock"}
        </Button>
      </form>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </Card>
  );
}
