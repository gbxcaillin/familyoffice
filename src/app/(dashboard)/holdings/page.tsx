"use client";

import { useEffect, useState, useCallback } from "react";

interface Holding {
  id: string;
  account_id: string;
  account_name: string;
  account_owner: string;
  ticker: string;
  name: string | null;
  units: number;
  cost_basis: number;
  currency: string;
  notes: string | null;
  cached_price: number | null;
  cached_change_percent: number | null;
  cached_dividend_yield: number | null;
  cached_annual_dividend: number | null;
  cached_name: string | null;
  cached_exchange: string | null;
  price_updated_at: string | null;
  market_value: number | null;
  total_cost: number;
  gain_loss: number | null;
  gain_loss_percent: number | null;
  annual_income: number | null;
  display_name: string;
}

interface Account {
  id: string;
  name: string;
  type: string;
  owner: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return formatCurrency(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function HoldingsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [form, setForm] = useState({
    account_id: "",
    ticker: "",
    name: "",
    units: "",
    cost_basis: "",
    currency: "AUD",
    notes: "",
  });

  const loadHoldings = useCallback(async () => {
    const res = await fetch("/api/holdings");
    const data = await res.json();
    setHoldings(data);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/holdings").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
    ]).then(([h, a]) => {
      setHoldings(h);
      setAccounts(a);
      setLoading(false);
    });
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await fetch("/api/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    await loadHoldings();
    setRefreshing(false);
  }

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const res = await fetch("/api/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", ticker: query }),
    });
    const data = await res.json();
    setSearchResults(data);
    setSearching(false);
  }

  function selectTicker(result: SearchResult) {
    setForm((f) => ({
      ...f,
      ticker: result.symbol,
      name: result.name,
    }));
    setSearchQuery("");
    setSearchResults([]);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.account_id || !form.ticker || !form.units) return;

    await fetch("/api/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        units: parseFloat(form.units),
        cost_basis: parseFloat(form.cost_basis || "0"),
      }),
    });

    setForm({
      account_id: "",
      ticker: "",
      name: "",
      units: "",
      cost_basis: "",
      currency: "AUD",
      notes: "",
    });
    setShowAdd(false);
    await loadHoldings();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/holdings?id=${id}`, { method: "DELETE" });
    await loadHoldings();
  }

  const totalMarketValue = holdings.reduce(
    (sum, h) => sum + (h.market_value || 0),
    0
  );
  const totalCost = holdings.reduce((sum, h) => sum + h.total_cost, 0);
  const totalGainLoss = totalMarketValue - totalCost;
  const totalGainLossPercent =
    totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
  const totalAnnualIncome = holdings.reduce(
    (sum, h) => sum + (h.annual_income || 0),
    0
  );
  const lastUpdated = holdings.find((h) => h.price_updated_at)?.price_updated_at;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
            Holdings
          </h1>
          <p className="text-sm text-gbx-muted font-body mt-1">
            Live market data via Yahoo Finance
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium border border-gbx-teal text-gbx-teal hover:bg-gbx-teal hover:text-white transition-colors disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh Prices"}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium bg-gbx-teal text-white hover:bg-gbx-deep-teal transition-colors"
          >
            {showAdd ? "Cancel" : "Add Holding"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gbx-charcoal border border-white/5 p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-1">
            Portfolio Value
          </p>
          <p className="font-data text-3xl text-white">
            {formatCurrency(totalMarketValue)}
          </p>
          <p className="text-xs text-white/40 font-body mt-1">
            {holdings.length} holding{holdings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="bg-white border border-gbx-border p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Total Cost Basis
          </p>
          <p className="font-data text-2xl text-gbx-charcoal">
            {formatCurrency(totalCost)}
          </p>
        </div>
        <div className="bg-white border border-gbx-border p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Unrealised Gain/Loss
          </p>
          <p
            className={`font-data text-2xl ${
              totalGainLoss >= 0 ? "text-gbx-teal" : "text-red-600"
            }`}
          >
            {totalGainLoss >= 0 ? "+" : ""}
            {formatCurrency(totalGainLoss)}
          </p>
          <p
            className={`text-xs font-data mt-1 ${
              totalGainLossPercent >= 0 ? "text-gbx-teal" : "text-red-600"
            }`}
          >
            {formatPercent(totalGainLossPercent)}
          </p>
        </div>
        <div className="bg-white border border-gbx-border p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Annual Dividend Income
          </p>
          <p className="font-data text-2xl text-gbx-teal">
            {formatCurrency(totalAnnualIncome)}
          </p>
          <p className="text-xs text-gbx-muted font-data mt-1">
            {totalMarketValue > 0
              ? `${((totalAnnualIncome / totalMarketValue) * 100).toFixed(2)}% yield`
              : "—"}
          </p>
        </div>
      </div>

      {/* Add holding form */}
      {showAdd && (
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Add New Holding
          </h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Account */}
              <div>
                <label className="block text-xs font-body text-gbx-muted mb-1">
                  Account
                </label>
                <select
                  value={form.account_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, account_id: e.target.value }))
                  }
                  required
                  className="w-full px-3 py-2 border border-gbx-border bg-white text-sm font-body text-gbx-charcoal focus:border-gbx-teal focus:outline-none"
                >
                  <option value="">Select account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.owner})
                    </option>
                  ))}
                </select>
              </div>

              {/* Ticker search */}
              <div className="relative">
                <label className="block text-xs font-body text-gbx-muted mb-1">
                  Ticker
                </label>
                <input
                  type="text"
                  value={form.ticker || searchQuery}
                  onChange={(e) => {
                    if (form.ticker) {
                      setForm((f) => ({ ...f, ticker: "", name: "" }));
                    }
                    handleSearch(e.target.value);
                  }}
                  placeholder="Search ticker (e.g. CBA, AAPL)"
                  required
                  className="w-full px-3 py-2 border border-gbx-border text-sm font-data text-gbx-charcoal focus:border-gbx-teal focus:outline-none"
                />
                {searching && (
                  <p className="absolute mt-1 text-xs text-gbx-muted">
                    Searching...
                  </p>
                )}
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gbx-border shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((r) => (
                      <button
                        key={r.symbol}
                        type="button"
                        onClick={() => selectTicker(r)}
                        className="w-full text-left px-3 py-2 hover:bg-gbx-soft border-b border-gbx-border last:border-0"
                      >
                        <span className="font-data text-sm text-gbx-charcoal">
                          {r.symbol}
                        </span>
                        <span className="text-xs text-gbx-muted ml-2">
                          {r.name}
                        </span>
                        <span className="text-[10px] text-gbx-muted ml-1">
                          ({r.exchange})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {form.ticker && (
                  <p className="mt-1 text-xs text-gbx-teal font-data">
                    {form.ticker} — {form.name}
                  </p>
                )}
              </div>

              {/* Units */}
              <div>
                <label className="block text-xs font-body text-gbx-muted mb-1">
                  Units
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.units}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, units: e.target.value }))
                  }
                  required
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gbx-border text-sm font-data text-gbx-charcoal focus:border-gbx-teal focus:outline-none"
                />
              </div>

              {/* Cost basis */}
              <div>
                <label className="block text-xs font-body text-gbx-muted mb-1">
                  Cost Basis (per unit)
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.cost_basis}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost_basis: e.target.value }))
                  }
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gbx-border text-sm font-data text-gbx-charcoal focus:border-gbx-teal focus:outline-none"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-body text-gbx-muted mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Optional"
                  className="w-full px-3 py-2 border border-gbx-border text-sm font-body text-gbx-charcoal focus:border-gbx-teal focus:outline-none"
                />
              </div>

              {/* Submit */}
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
                >
                  Add Holding
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Holdings table */}
      {holdings.length === 0 ? (
        <div className="bg-white border border-gbx-border p-12 text-center">
          <p className="text-gbx-muted font-body text-sm">
            No holdings yet. Add your first holding to start tracking.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gbx-border overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gbx-border">
                {[
                  "Ticker",
                  "Name",
                  "Account",
                  "Units",
                  "Price",
                  "Day %",
                  "Market Value",
                  "Cost Basis",
                  "Gain/Loss",
                  "Div Yield",
                  "Annual Income",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-gbx-border/50 hover:bg-gbx-soft/30 transition-colors"
                >
                  <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal">
                    {h.ticker}
                  </td>
                  <td className="px-4 py-3 text-sm font-body text-gbx-charcoal max-w-[200px] truncate">
                    {h.display_name}
                  </td>
                  <td className="px-4 py-3 text-xs font-body text-gbx-muted">
                    {h.account_name}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                    {h.units.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                    {h.cached_price
                      ? formatCurrency(h.cached_price)
                      : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 font-data text-sm ${
                      (h.cached_change_percent || 0) >= 0
                        ? "text-gbx-teal"
                        : "text-red-600"
                    }`}
                  >
                    {formatPercent(h.cached_change_percent)}
                  </td>
                  <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal">
                    {h.market_value !== null
                      ? formatCurrency(h.market_value)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-gbx-muted">
                    {formatCurrency(h.total_cost)}
                  </td>
                  <td
                    className={`px-4 py-3 font-data text-sm ${
                      (h.gain_loss || 0) >= 0
                        ? "text-gbx-teal"
                        : "text-red-600"
                    }`}
                  >
                    {h.gain_loss !== null ? (
                      <>
                        {h.gain_loss >= 0 ? "+" : ""}
                        {formatCurrency(h.gain_loss)}
                        <span className="text-[10px] ml-1">
                          ({formatPercent(h.gain_loss_percent)})
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                    {h.cached_dividend_yield !== null
                      ? `${h.cached_dividend_yield.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-data text-sm text-gbx-teal">
                    {h.annual_income !== null
                      ? formatCurrency(h.annual_income)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(h.id)}
                      className="text-xs text-gbx-muted hover:text-red-600 font-body transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gbx-border bg-gbx-soft/30">
                <td
                  colSpan={4}
                  className="px-4 py-3 text-xs uppercase tracking-[0.15em] font-body font-medium text-gbx-muted"
                >
                  Totals
                </td>
                <td colSpan={2} />
                <td className="px-4 py-3 font-data text-sm font-bold text-gbx-charcoal">
                  {formatCurrency(totalMarketValue)}
                </td>
                <td className="px-4 py-3 font-data text-sm text-gbx-muted">
                  {formatCurrency(totalCost)}
                </td>
                <td
                  className={`px-4 py-3 font-data text-sm font-bold ${
                    totalGainLoss >= 0 ? "text-gbx-teal" : "text-red-600"
                  }`}
                >
                  {totalGainLoss >= 0 ? "+" : ""}
                  {formatCurrency(totalGainLoss)}
                  <span className="text-[10px] ml-1">
                    ({formatPercent(totalGainLossPercent)})
                  </span>
                </td>
                <td />
                <td className="px-4 py-3 font-data text-sm font-bold text-gbx-teal">
                  {formatCurrency(totalAnnualIncome)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          {lastUpdated && (
            <p className="px-4 py-2 text-[10px] text-gbx-muted font-body border-t border-gbx-border/50">
              Prices last updated:{" "}
              {new Date(lastUpdated + "Z").toLocaleString("en-AU")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
