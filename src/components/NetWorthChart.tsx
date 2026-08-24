"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  date: string;
  total: number;
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
}

export default function NetWorthChart({
  data,
  label = "Net Worth",
}: {
  data: DataPoint[];
  label?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gbx-muted text-sm font-body">
        Add balance snapshots to see your net worth trend
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2E8B6E" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#2E8B6E" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fontFamily: "var(--font-dm-mono)", fill: "#8A8578" }}
        />
        <YAxis
          tickFormatter={formatCurrency}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fontFamily: "var(--font-dm-mono)", fill: "#8A8578" }}
          width={60}
        />
        <Tooltip
          formatter={(value) => [`$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`, label]}
          labelFormatter={(label) => formatDate(String(label))}
          contentStyle={{
            background: "#1A1A1A",
            border: "1px solid rgba(46,139,110,0.3)",
            borderRadius: 0,
            color: "#fff",
            fontSize: 12,
            fontFamily: "var(--font-dm-mono)",
          }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="#2E8B6E"
          strokeWidth={2}
          fill="url(#tealGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
