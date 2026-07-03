"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmTransferAction, rejectTransferAction } from "@/lib/actions/transactions";
import { formatPaise } from "@/lib/domain/money";
import type { PendingTransferLink } from "@/lib/repos/reports";

export function TransferReview({ links }: { links: PendingTransferLink[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <ul className="space-y-2">
      {links.map((l) => (
        <li key={l.id} className="rounded-lg border border-hairline p-2 text-xs">
          <p className="mb-1 font-medium tnum">{formatPaise(l.amount_paise)}</p>
          <p className="truncate text-ink-secondary" title={l.narration_a}>
            {l.date_a} · {l.account_a}
          </p>
          <p className="truncate text-ink-secondary" title={l.narration_b}>
            {l.date_b} · {l.account_b}
          </p>
          <div className="mt-1.5 flex gap-2">
            <button
              disabled={pending}
              className="rounded-md bg-success-bg px-2 py-0.5 font-medium text-success"
              onClick={() =>
                startTransition(async () => {
                  await confirmTransferAction(l.id);
                  router.refresh();
                })
              }
            >
              Same money — link
            </button>
            <button
              disabled={pending}
              className="rounded-md bg-hairline/50 px-2 py-0.5 font-medium text-ink-secondary"
              onClick={() =>
                startTransition(async () => {
                  await rejectTransferAction(l.id);
                  router.refresh();
                })
              }
            >
              Unrelated
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
