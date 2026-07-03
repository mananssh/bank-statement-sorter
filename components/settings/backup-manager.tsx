"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelRestoreAction,
  restoreBackupAction,
  snapshotNowAction,
} from "@/lib/actions/settings";
import type { BackupInfo } from "@/lib/db/autosave";
import { Badge, Button, Card, CardTitle, cx } from "@/components/ui";

const KIND_LABEL: Record<string, string> = {
  auto: "auto",
  boot: "boot",
  shutdown: "shutdown",
  manual: "manual",
};

export function BackupManager({
  backups,
  hasPendingRestore,
}: {
  backups: BackupInfo[];
  hasPendingRestore: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>Automatic backups</CardTitle>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => run(snapshotNowAction)}
          className="text-xs"
        >
          Snapshot now
        </Button>
      </div>

      <p className="mb-3 text-xs text-ink-secondary">
        The database is checkpointed every minute and snapshotted every 5 minutes into{" "}
        <code className="font-mono">data/backups/</code> (gitignored), plus at every server start
        and clean shutdown. Restoring swaps the chosen snapshot in on the next server start — the
        current database is set aside, never deleted.
      </p>

      {hasPendingRestore ? (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
          <span>A restore is staged — restart the server to apply it.</span>
          <button
            className="text-xs underline hover:opacity-80"
            disabled={pending}
            onClick={() => run(cancelRestoreAction)}
          >
            cancel
          </button>
        </div>
      ) : null}

      {backups.length === 0 ? (
        <p className="text-sm text-ink-muted">No snapshots yet — they appear as the app runs.</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {backups.slice(0, 12).map((b) => {
            const kind = b.name.split("-")[0];
            return (
              <li key={b.name} className="flex items-center gap-3 py-1.5 text-sm">
                <Badge tone={kind === "manual" ? "info" : "neutral"}>
                  {KIND_LABEL[kind] ?? "backup"}
                </Badge>
                <span className="flex-1 truncate font-mono text-xs text-ink-secondary">
                  {b.name}
                </span>
                <span className="tnum whitespace-nowrap text-xs text-ink-muted">
                  {new Date(b.mtime).toLocaleString()} · {(b.size / 1024).toFixed(0)} KB
                </span>
                {confirming === b.name ? (
                  <span className="flex items-center gap-1.5">
                    <button
                      className="rounded bg-danger px-2 py-0.5 text-xs font-medium text-white"
                      disabled={pending}
                      onClick={() => run(() => restoreBackupAction(b.name))}
                    >
                      confirm restore
                    </button>
                    <button
                      className="text-xs text-ink-muted hover:text-ink"
                      onClick={() => setConfirming(null)}
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    className={cx(
                      "text-xs text-accent hover:underline",
                      pending && "pointer-events-none opacity-50",
                    )}
                    onClick={() => setConfirming(b.name)}
                  >
                    restore
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </Card>
  );
}
