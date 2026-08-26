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
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white border border-gbx-border p-4 sm:p-6">
      <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
        {label}
      </p>
      <p className="font-data text-lg sm:text-2xl text-gbx-charcoal break-words">{value}</p>
      {sub && (
        <p className="text-xs text-gbx-muted font-body mt-1">{sub}</p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [users, setUsers] = useState({ person1: "Person 1", person2: "Person 2" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    <div className="space-y-8">
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="bg-gbx-charcoal border border-white/5 p-4 sm:p-6 col-span-2 lg:col-span-1">
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
        </div>
        <StatCard
          label={users.person1}
          value={formatCurrency(data.person1Total)}
          sub="Individual holdings"
        />
        <StatCard
          label={users.person2}
          value={formatCurrency(data.person2Total)}
          sub="Individual holdings"
        />
        <StatCard
          label="Joint"
          value={formatCurrency(data.jointTotal)}
          sub="Shared accounts"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

      <MortgageProjection />
    </div>
  );
}
