"use client";

import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  CartesianGrid,
} from "recharts";
import { formatPaise } from "@/lib/domain/money";
import type { MonthlyRollupRow } from "@/lib/repos/reports";
import { monthLabel } from "@/lib/domain/fy";

export function CashflowChart({ data }: { data: MonthlyRollupRow[] }) {
  const rows = data.map((d) => ({
    month: monthLabel(d.month).replace(/ \d{4}$/, ""),
    Income: d.credits_paise / 100,
    Expenses: d.debits_paise / 100,
    Invested: d.investments_paise / 100,
    "Net flow": d.net_flow_paise / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
        <CartesianGrid stroke="var(--grid-line)" vertical={false} strokeWidth={1} />
        <XAxis
          dataKey="month"
          tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--axis)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
          tickFormatter={(v: number) => formatPaise(v * 100, { compact: true })}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          formatter={(value) => formatPaise(Math.round(Number(value ?? 0) * 100))}
          contentStyle={{
            background: "var(--surface-raised)",
            border: "1px solid var(--hairline)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--ink)",
          }}
          cursor={{ fill: "var(--hairline)", opacity: 0.4 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-secondary)" }} iconSize={10} />
        <Bar dataKey="Income" fill="var(--credit)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="Expenses" fill="var(--debit)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="Invested" fill="var(--investment)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Line
          type="monotone"
          dataKey="Net flow"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
