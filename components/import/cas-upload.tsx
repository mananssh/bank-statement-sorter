"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importCasAction, type CasImportState } from "@/lib/actions/cas";
import { Button, Card, CardTitle, cx } from "@/components/ui";

/**
 * CAS PDF import card: CAMS/KFintech detailed CAS (MF transaction history)
 * and NSDL/CDSL e-CAS (demat stock/ETF positions + MF units cross-check).
 * The password field is submitted once and never stored.
 */
export function CasUpload() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CasImportState | null>(null);

  return (
    <Card>
      <CardTitle>Investment statement (CAS PDF)</CardTitle>
      <p className="mb-3 text-xs text-ink-secondary">
        CAMS/KFintech <span className="font-medium">detailed CAS</span> imports your mutual-fund
        transactions; NSDL/CDSL <span className="font-medium">e-CAS</span> imports demat stock/ETF
        positions and cross-checks MF units. Parsed locally; the PDF password is used once,
        in memory only.
      </p>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            const res = await importCasAction(null, fd);
            setState(res);
            if (res.ok) formRef.current?.reset();
            router.refresh();
          });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="file"
          name="file"
          accept=".pdf,application/pdf"
          required
          className="text-xs file:mr-2 file:rounded-md file:border file:border-edge file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-ink"
        />
        <input
          type="password"
          name="password"
          placeholder="PDF password (if any)"
          autoComplete="off"
          className="rounded-md border border-edge bg-transparent px-2 py-1 text-xs"
        />
        <Button type="submit" variant="ghost" disabled={pending} className="text-xs">
          {pending ? "Importing…" : "Import CAS"}
        </Button>
      </form>
      {state ? (
        <div className="mt-2 space-y-1 text-xs">
          <p className={cx(state.ok ? "text-success" : "text-danger")}>{state.summary}</p>
          {state.warnings.map((w) => (
            <p key={w} className="text-warning">
              ⚠ {w}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
