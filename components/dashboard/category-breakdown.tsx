"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/domain/money";
import { assignSliceColors } from "@/lib/ui/colors";
import { Card, CardTitle, cx } from "@/components/ui";
import { CategoryDonut, type DonutDatum } from "@/components/dashboard/category-donut";

export interface BreakdownRow {
  category_id: number;
  category_name: string;
  category_type: string;
  total_paise: number;
  pct: number | null; // share of this group's total
  txn_count: number;
  avg_paise: number;
  largest_paise: number;
  last_date: string;
}

type GroupKey = "expense" | "income" | "investment";

const GROUP_META: Record<GroupKey, { label: string; center: string; tone: string }> = {
  expense: { label: "Expenses", center: "Expenses", tone: "text-debit" },
  income: { label: "Income", center: "Income", tone: "text-credit" },
  investment: { label: "Investments", center: "Invested", tone: "text-investment" },
};

/**
 * Category breakdown with an income/expense/investment toggle. Each view shares
 * one distinct-per-slice color assignment between the donut and the table, so a
 * category's swatch means the same thing in both.
 */
export function CategoryBreakdown({
  fy,
  groups,
  totals,
}: {
  fy: number;
  groups: Record<GroupKey, BreakdownRow[]>;
  totals: Record<GroupKey, number>;
}) {
  const available = (["expense", "income", "investment"] as GroupKey[]).filter(
    (g) => groups[g].length > 0,
  );
  const [active, setActive] = useState<GroupKey>(available[0] ?? "expense");
  const rows = groups[active] ?? [];

  const colors = useMemo(
    () => assignSliceColors(rows.map((r) => r.category_id)),
    [rows],
  );

  const donutData: DonutDatum[] = useMemo(() => {
    const top = rows.slice(0, 7);
    const rest = rows.slice(7);
    const data: DonutDatum[] = top.map((r) => ({
      id: r.category_id,
      name: r.category_name,
      value: r.total_paise / 100,
      color: colors.get(r.category_id) ?? "var(--ink-muted)",
    }));
    if (rest.length) {
      data.push({
        id: -1,
        name: "Other",
        value: rest.reduce((s, r) => s + r.total_paise, 0) / 100,
        color: "var(--ink-muted)",
      });
    }
    return data;
  }, [rows, colors]);

  if (available.length === 0) {
    return (
      <Card>
        <CardTitle>Category breakdown</CardTitle>
        <p className="text-sm text-ink-muted">No categorized transactions yet.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Breakdown</CardTitle>
          <div className="flex gap-1">
            {available.map((g) => (
              <button
                key={g}
                onClick={() => setActive(g)}
                className={cx(
                  "rounded-md px-2 py-0.5 text-xs font-medium",
                  g === active
                    ? "bg-accent text-accent-ink"
                    : "border border-edge text-ink-secondary hover:bg-hairline/40",
                )}
              >
                {GROUP_META[g].label}
              </button>
            ))}
          </div>
        </div>
        <CategoryDonut
          data={donutData}
          centerLabel={GROUP_META[active].center}
          centerValuePaise={totals[active]}
        />
      </Card>

      <Card className="xl:col-span-2">
        <CardTitle>
          {GROUP_META[active].label} by category — {formatPaise(totals[active])}
        </CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <Th>Category</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">% of {active}</Th>
                <Th className="text-right">Txns</Th>
                <Th className="text-right">Avg</Th>
                <Th className="text-right">Largest</Th>
                <Th>Last</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category_id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: colors.get(r.category_id) ?? "var(--ink-muted)" }}
                      />
                      <Link
                        href={`/transactions?fy=${fy}&category=${r.category_id}`}
                        className="font-medium hover:text-accent"
                      >
                        {r.category_name}
                      </Link>
                    </span>
                  </Td>
                  <Td className="text-right tnum font-medium">{formatPaise(r.total_paise)}</Td>
                  <Td className="text-right tnum text-ink-secondary">
                    {r.pct !== null ? `${(r.pct * 100).toFixed(1)}%` : "—"}
                  </Td>
                  <Td className="text-right tnum">{r.txn_count}</Td>
                  <Td className="text-right tnum text-ink-secondary">{formatPaise(r.avg_paise)}</Td>
                  <Td className="text-right tnum text-ink-secondary">
                    {formatPaise(r.largest_paise)}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-muted">{r.last_date}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        "border-b border-hairline px-3 py-2 text-left text-[11px] font-semibold",
        "uppercase tracking-wider text-ink-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cx("border-b border-hairline/60 px-3 py-1.5 align-middle", className)}>
      {children}
    </td>
  );
}
