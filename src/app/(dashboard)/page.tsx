"use client";

import { useEffect, useState } from "react";
import NetWorthChart from "@/components/NetWorthChart";
import SpendingChart from "@/components/SpendingChart";
import MortgageProjection from "@/components/MortgageProjection";

interface NetWorthData {
  totalNetWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  person1Total: number;
  person2Total: number;
  jointTotal: number;
  holdingsTotal: number;
  byType: Record<string, number>;
  balanceHistory: { date: string; total: number }[];
  recentSpending: { category: string; total: number }[];
  recentIncome: number;
  recentExpenses: number;
  accountCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  bank: "Banking",
  brokerage: "Brokerage",
  super: "Superannuation",
  property: "Property",
  crypto: "Crypto",
  loan: "Loans",
  other: "Other",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function StatCard({
  label,
  value,
  sub,
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border p-4 sm:p-6 transition-colors ${
        active ? "border-gbx-teal" : "border-gbx-border hover:border-gbx-teal/50"
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
        {label}
      </p>
      <p className="font-data text-lg sm:text-2xl text-gbx-charcoal break-words">{value}</p>
      {sub && <p className="text-xs text-gbx-muted font-body mt-1">{sub}</p>}
    </button>
  );
}

interface LineItem {
  label: string;
  sub: string;
  value: number;
  kind: "account" | "holding";
}
interface Breakdown {
  total: { items: LineItem[]; total: number };
  person1: { items: LineItem[]; total: number };
  person2: { items: LineItem[]; total: number };
  joint: { items: LineItem[]; total: number };
}

function BreakdownPanel({
  title,
  items,
  onClose,
}: {
  title: string;
  items: LineItem[];
  onClose: () => void;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="bg-white border border-gbx-teal/40 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
          {title} — what it&apos;s made of
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-gbx-muted hover:text-gbx-charcoal font-body"
        >
          Close ✕
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gbx-muted font-body">Nothing in this group yet.</p>
      ) : (
        <div className="divide-y divide-gbx-border/60">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between py-2 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-body text-gbx-charcoal truncate">
                  {it.label}
                  {it.kind === "holding" && (
                    <span className="text-[10px] uppercase tracking-[0.1em] text-gbx-muted ml-2">
                      holding
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gbx-muted font-body truncate">{it.sub}</p>
              </div>
              <p
                className={`font-data text-sm whitespace-nowrap ${
                  it.value < 0 ? "text-red-600" : "text-gbx-charcoal"
                }`}
              >
                {it.value < 0 ? "-" : ""}
                {formatCurrency(Math.abs(it.value))}
              </p>
            </div>
          ))}
          <div className="flex items-center justify-between py-3 mt-1">
            <p className="text-xs uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">
              Total
            </p>
            <p
              className={`font-data text-base font-bold ${
                total < 0 ? "text-red-600" : "text-gbx-charcoal"
              }`}
            >
              {total < 0 ? "-" : ""}
              {formatCurrency(Math.abs(total))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [users, setUsers] = useState({ person1: "Person 1", person2: "Person 2" });
  const [loading, setLoading] = useState(true);
  const [sectionOrder, setSectionOrder] = useState<string[]>([
    "stats", "charts", "allocation", "mortgage",
  ]);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [selected, setSelected] = useState<
    "total" | "person1" | "person2" | "joint" | null
  >(null);

  function pick(bucket: "total" | "person1" | "person2" | "joint") {
    setSelected((s) => (s === bucket ? null : bucket));
    if (!breakdown) {
      fetch("/api/networth/breakdown")
        .then((r) => r.json())
        .then(setBreakdown)
        .catch(() => {});
    }
  }

  const orderOf = (id: string) => {
    const i = sectionOrder.indexOf(id);
    return i === -1 ? 99 : 10 + i;
  };

  useEffect(() => {
    fetch("/api/prefs")
      .then((r) => r.json())
      .then((p) => {
        if (Array.isArray(p?.dashboardOrder)) setSectionOrder(p.dashboardOrder);
      })
      .catch(() => {});
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
    fetch("/api/networth")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-8">
      {/* Page heading */}
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
          Net Worth Overview
        </h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          Combined financial position
        </p>
      </div>

      {/* Top stat cards */}
      <div className="flex flex-col gap-4" style={{ order: orderOf("stats") }}>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <button
            onClick={() => pick("total")}
            className={`text-left bg-gbx-charcoal border p-4 sm:p-6 col-span-2 lg:col-span-1 transition-colors ${
              selected === "total" ? "border-gbx-teal" : "border-white/5 hover:border-gbx-teal/40"
            }`}
          >
            <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-1">
              Total Net Worth
            </p>
            <p className="font-data text-2xl sm:text-3xl text-white break-words">
              {formatCurrency(data.totalNetWorth)}
            </p>
            <p className="text-xs text-white/40 font-body mt-1">
              {data.totalLiabilities > 0
                ? `Assets ${formatCurrency(data.totalAssets)} · Liabilities ${formatCurrency(data.totalLiabilities)}`
                : `Across ${data.accountCount} accounts${
                    data.holdingsTotal > 0
                      ? ` · ${formatCurrency(data.holdingsTotal)} in holdings`
                      : ""
                  }`}
            </p>
          </button>
          <StatCard
            label={users.person1}
            value={formatCurrency(data.person1Total)}
            sub="Tap to see breakdown"
            active={selected === "person1"}
            onClick={() => pick("person1")}
          />
          <StatCard
            label={users.person2}
            value={formatCurrency(data.person2Total)}
            sub="Tap to see breakdown"
            active={selected === "person2"}
            onClick={() => pick("person2")}
          />
          <StatCard
            label="Joint"
            value={formatCurrency(data.jointTotal)}
            sub="Tap to see breakdown"
            active={selected === "joint"}
            onClick={() => pick("joint")}
          />
        </div>

        {selected && breakdown && (
          <BreakdownPanel
            title={
              selected === "total"
                ? "Total net worth"
                : selected === "joint"
                  ? "Joint"
                  : selected === "person1"
                    ? users.person1
                    : users.person2
            }
            items={breakdown[selected].items}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ order: orderOf("charts") }}>
        {/* Net worth trend */}
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Net Worth Trend
          </h2>
          <NetWorthChart data={data.balanceHistory} />
        </div>

        {/* Spending breakdown */}
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Spending — Last 30 Days
          </h2>
          <SpendingChart data={data.recentSpending} />
        </div>
      </div>

      {/* Allocation + Cash flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ order: orderOf("allocation") }}>
        {/* Asset allocation by type */}
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Asset Allocation
          </h2>
          {Object.keys(data.byType).length === 0 ? (
            <p className="text-gbx-muted text-sm font-body">
              Add accounts to see allocation
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.byType)
                .filter(([, value]) => value >= 0)
                .sort(([, a], [, b]) => b - a)
                .map(([type, value]) => {
                  const pct =
                    data.totalAssets > 0
                      ? (value / data.totalAssets) * 100
                      : 0;
                  return (
                    <div key={type}>
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-sm font-body text-gbx-charcoal">
                          {TYPE_LABELS[type] || type}
                        </span>
                        <span className="font-data text-sm text-gbx-charcoal">
                          {formatCurrency(value)}
                        </span>
                      </div>
                      <div className="h-2 bg-gbx-soft rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-gbx-teal transition-all"
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-gbx-muted font-data mt-0.5">
                        {pct.toFixed(1)}%
                      </p>
                    </div>
                  );
                })}

              {data.totalLiabilities > 0 && (
                <div className="pt-3 border-t border-gbx-border">
                  <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-3">
                    Liabilities
                  </p>
                  {Object.entries(data.byType)
                    .filter(([, value]) => value < 0)
                    .sort(([, a], [, b]) => a - b)
                    .map(([type, value]) => {
                      const pct =
                        data.totalLiabilities > 0
                          ? (-value / data.totalLiabilities) * 100
                          : 0;
                      return (
                        <div key={type} className="mb-3 last:mb-0">
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-sm font-body text-gbx-charcoal">
                              {TYPE_LABELS[type] || type}
                            </span>
                            <span className="font-data text-sm text-red-600">
                              -{formatCurrency(-value)}
                            </span>
                          </div>
                          <div className="h-2 bg-gbx-soft rounded-sm overflow-hidden">
                            <div
                              className="h-full bg-red-600/70 transition-all"
                              style={{ width: `${Math.max(pct, 1)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 30-day cash flow */}
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Cash Flow — Last 30 Days
          </h2>
          <div className="space-y-4">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-body text-gbx-charcoal">
                Income
              </span>
              <span className="font-data text-lg text-gbx-teal">
                +{formatCurrency(data.recentIncome)}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-body text-gbx-charcoal">
                Expenses
              </span>
              <span className="font-data text-lg text-red-600">
                -{formatCurrency(data.recentExpenses)}
              </span>
            </div>
            <div className="border-t border-gbx-border pt-3 flex justify-between items-baseline">
              <span className="text-sm font-body font-medium text-gbx-charcoal">
                Net
              </span>
              <span
                className={`font-data text-xl ${
                  data.recentIncome - data.recentExpenses >= 0
                    ? "text-gbx-teal"
                    : "text-red-600"
                }`}
              >
                {formatCurrency(data.recentIncome - data.recentExpenses)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-8" style={{ order: orderOf("mortgage") }}>
        <MortgageProjection />
      </div>
    </div>
  );
}
