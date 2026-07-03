"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectSheetAction } from "@/lib/actions/import";
import { Card, CardTitle, cx } from "@/components/ui";

export function SheetPicker({ batchId, sheets }: { batchId: number; sheets: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Card className="max-w-md">
      <CardTitle>Which sheet holds the transactions?</CardTitle>
      <ul className="space-y-1">
        {sheets.map((name) => (
          <li key={name}>
            <button
              disabled={pending}
              onClick={() => {
                setSelected(name);
                startTransition(async () => {
                  await selectSheetAction(batchId, name);
                  router.refresh();
                });
              }}
              className={cx(
                "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                selected === name
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-edge hover:border-accent/50",
              )}
            >
              {name}
              {pending && selected === name ? " — analyzing…" : ""}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
