"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPaise } from "@/lib/domain/money";
import { seriesColorFor } from "@/lib/ui/colors";

export interface DonutSlice {
  category_id: number;
  name: string;
  value_paise: number;
}

/**
 * Expense breakdown. Top 7 categories + "Other"; identity is carried by the
 * adjacent category table (same colors) so sub-3:1 slices are never
 * color-alone — the relief rule from the palette validation.
 */
export function CategoryDonut({ slices, total_paise }: { slices: DonutSlice[]; total_paise: number }) {
  const top = slices.slice(0, 7);
  const rest = slices.slice(7);
  const data = [
    ...top.map((s) => ({
      id: s.category_id,
      name: s.name,
      value: s.value_paise / 100,
      color: seriesColorFor(s.category_id),
    })),
    ...(rest.length
      ? [
          {
            id: -1,
            name: "Other",
            value: rest.reduce((sum, s) => sum + s.value_paise, 0) / 100,
            color: "var(--ink-muted)",
          },
        ]
      : []),
  ];

  return (
    <div className="relative h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            formatter={(value) => formatPaise(Math.round(Number(value ?? 0) * 100))}
            contentStyle={{
              background: "var(--surface-raised)",
              border: "1px solid var(--hairline)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--ink)",
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="var(--surface)"
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.id} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] uppercase tracking-wider text-ink-muted">Expenses</span>
        <span className="text-lg font-semibold tnum">{formatPaise(total_paise, { compact: true })}</span>
      </div>
    </div>
  );
}
