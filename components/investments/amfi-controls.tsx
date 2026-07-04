"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchAmfiNavsAction, toggleAmfiAction } from "@/lib/actions/investments";
import { Button, cx } from "@/components/ui";

/** Settings card control: the explicit opt-in for the app's only external call. */
export function AmfiToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        defaultChecked={enabled}
        disabled={pending}
        className="mt-0.5"
        onChange={(e) =>
          startTransition(async () => {
            await toggleAmfiAction(e.target.checked);
            router.refresh();
          })
        }
      />
      <span>
        <span className="font-medium">Fetch mutual-fund NAVs from AMFI</span>
        <span className="block text-xs text-ink-secondary">
          The app&apos;s only external call: one GET to amfiindia.com&apos;s public NAV file,
          triggered manually from the Investments page. Nothing about you or your data is sent.
          Off = fully air-gapped, enter NAVs by hand.
        </span>
      </span>
    </label>
  );
}

/** Investments-page button: manual trigger, shows the outcome inline. */
export function AmfiFetchButton({
  enabled,
  lastFetch,
}: {
  enabled: boolean;
  lastFetch: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (!enabled) {
    return (
      <p className="text-xs text-ink-muted">
        NAV auto-fetch is off (Settings → enable AMFI) — NAVs are manual.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        disabled={pending}
        className="text-xs"
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const res = await fetchAmfiNavsAction();
            if (res.ok) {
              setFailed(false);
              setMessage(
                `Updated ${res.result.updated} NAV(s)` +
                  (res.result.nav_date ? ` as of ${res.result.nav_date}` : "") +
                  (res.result.unmatched.length
                    ? ` — ${res.result.unmatched.length} instrument(s) unmatched (set their ISIN)`
                    : ""),
              );
            } else {
              setFailed(true);
              setMessage(res.error ?? "Fetch failed.");
            }
            router.refresh();
          })
        }
      >
        {pending ? "Fetching…" : "Update NAVs from AMFI"}
      </Button>
      {message ? (
        <span className={cx("text-xs", failed ? "text-danger" : "text-success")}>{message}</span>
      ) : lastFetch ? (
        <span className="text-xs text-ink-muted">
          last fetched {new Date(lastFetch).toLocaleString()}
        </span>
      ) : null}
    </div>
  );
}
