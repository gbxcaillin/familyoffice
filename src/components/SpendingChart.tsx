"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface SpendItem {
  category: string;
  total: number;
}

const COLORS = [
  "#2E8B6E", "#1A5C4A", "#C44E52", "#DD8452", "#937DC2",
  "#4C72B0", "#8C8C8C", "#CCB974", "#64B5CD", "#DA8BC3",
];

export default function SpendingChart({ data }: { data: SpendItem[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gbx-muted text-sm font-body">
        Add transactions to see spending breakdown
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} layout="vertical">
        <XAxis
          type="number"
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fontFamily: "var(--font-dm-mono)", fill: "#8A8578" }}
        />
        <YAxis
          type="category"
          dataKey="category"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fontFamily: "var(--font-body)", fill: "#1A1A1A" }}
          width={100}
        />
        <Tooltip
          formatter={(value) => [`$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`, "Spent"]}
          contentStyle={{
            background: "#1A1A1A",
            border: "1px solid rgba(46,139,110,0.3)",
            borderRadius: 0,
            color: "#fff",
            fontSize: 12,
            fontFamily: "var(--font-dm-mono)",
          }}
        />
        <Bar dataKey="total" radius={[0, 2, 2, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
