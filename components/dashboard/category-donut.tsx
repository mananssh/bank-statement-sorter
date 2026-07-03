"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPaise } from "@/lib/domain/money";

export interface DonutDatum {
  id: number;
  name: string;
  value: number; // rupees
  color: string;
}

/**
 * Generic donut. Colors are supplied by the caller (distinct per slice) so the
 * donut and the table beside it share one assignment — identity is never
 * color-alone because the table repeats the swatch + label.
 */
export function CategoryDonut({
  data,
  centerLabel,
  centerValuePaise,
}: {
  data: DonutDatum[];
  centerLabel: string;
  centerValuePaise: number;
}) {
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
        <span className="text-[10px] uppercase tracking-wider text-ink-muted">{centerLabel}</span>
        <span className="text-lg font-semibold tnum">
          {formatPaise(centerValuePaise, { compact: true })}
        </span>
      </div>
    </div>
  );
}
