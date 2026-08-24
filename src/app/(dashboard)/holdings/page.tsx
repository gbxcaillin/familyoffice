"use client";

import { useEffect, useState, useCallback } from "react";
import NetWorthChart from "@/components/NetWorthChart";

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

interface Trade {
  id: string;
  account_id: string;
  account_name: string;
  ticker: string;
  side: "buy" | "sell";
  units: number;
  price: number;
  fees: number;
  trade_date: string;
  notes: string | null;
  total_value: number;
  realised: number | null;
  avg_cost_at_sale: number | null;
}

interface PerfAsset {
  ticker: string;
  name: string;
  units: number;
  cost_basis: number;
  startPrice: number | null;
  endPrice: number | null;
  changePercent: number | null;
  startValue: number | null;
  endValue: number | null;
}

interface PerfData {
  from: string;
  to: string;
  interval: string;
  perAsset: PerfAsset[];
  portfolio: { date: string; total: number }[];
  portfolioReturn: number | null;
}

type PerfPeriod = "1y" | "3y" | "5y" | "all" | "custom";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

  // Trades
  const [trades, setTrades] = useState<Trade[]>([]);
  const [totalRealised, setTotalRealised] = useState(0);
  const [showTrade, setShowTrade] = useState(false);
  const [savingTrade, setSavingTrade] = useState(false);
  const [tradeQuery, setTradeQuery] = useState("");
  const [tradeResults, setTradeResults] = useState<SearchResult[]>([]);
  const [tradeForm, setTradeForm] = useState({
    account_id: "",
    ticker: "",
    side: "buy" as "buy" | "sell",
    units: "",
    price: "",
    fees: "",
    trade_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  // Performance
  const [perf, setPerf] = useState<PerfData | null>(null);
  const [perfPeriod, setPerfPeriod] = useState<PerfPeriod>("1y");
  const [perfLoading, setPerfLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const loadHoldings = useCallback(async () => {
    const res = await fetch("/api/holdings");
    const data = await res.json();
    setHoldings(data);
  }, []);

  const loadTrades = useCallback(async () => {
    const res = await fetch("/api/trades");
    const data = await res.json();
    setTrades(data.trades || []);
    setTotalRealised(data.totalRealised || 0);
  }, []);

  const loadPerformance = useCallback(
    async (period: PerfPeriod, from?: string, to?: string) => {
      setPerfLoading(true);
      const params = new URLSearchParams();
      if (period === "custom") {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      } else {
        params.set("period", period);
      }
      try {
        const res = await fetch(`/api/performance?${params.toString()}`);
        const data = await res.json();
        if (!data.error) setPerf(data);
      } finally {
        setPerfLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    Promise.all([
      fetch("/api/holdings").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/trades").then((r) => r.json()),
    ]).then(([h, a, t]) => {
      setHoldings(h);
      setAccounts(a);
      setTrades(t.trades || []);
      setTotalRealised(t.totalRealised || 0);
      setLoading(false);
      if (h.length > 0) loadPerformance("1y");
    });
  }, [loadPerformance]);

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

  async function searchTickers(query: string): Promise<SearchResult[]> {
    const res = await fetch("/api/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", ticker: query }),
    });
    return res.json();
  }

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setSearchResults(await searchTickers(query));
    setSearching(false);
  }

  async function handleTradeSearch(query: string) {
    setTradeQuery(query);
    if (query.length < 2) {
      setTradeResults([]);
      return;
    }
    setTradeResults(await searchTickers(query));
  }

  function selectTicker(result: SearchResult) {
    setForm((f) => ({ ...f, ticker: result.symbol, name: result.name }));
    setSearchQuery("");
    setSearchResults([]);
  }

  function selectTradeTicker(result: SearchResult) {
    setTradeForm((f) => ({ ...f, ticker: result.symbol }));
    setTradeQuery("");
    setTradeResults([]);
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

  async function handleAddTrade(e: React.FormEvent) {
    e.preventDefault();
    if (
      !tradeForm.account_id ||
      !tradeForm.ticker ||
      !tradeForm.units ||
      !tradeForm.price ||
      !tradeForm.trade_date
    )
      return;

    setSavingTrade(true);
    await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...tradeForm,
        units: parseFloat(tradeForm.units),
        price: parseFloat(tradeForm.price),
        fees: parseFloat(tradeForm.fees || "0"),
      }),
    });

    setTradeForm({
      account_id: "",
      ticker: "",
      side: "buy",
      units: "",
      price: "",
      fees: "",
      trade_date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
    setShowTrade(false);
    setSavingTrade(false);
    await Promise.all([loadHoldings(), loadTrades()]);
  }

  async function handleDeleteTrade(id: string) {
    await fetch(`/api/trades?id=${id}`, { method: "DELETE" });
    await Promise.all([loadHoldings(), loadTrades()]);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/holdings?id=${id}`, { method: "DELETE" });
    await loadHoldings();
  }

  function selectPeriod(p: PerfPeriod) {
    setPerfPeriod(p);
    if (p !== "custom") loadPerformance(p);
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

  const inputClass =
    "w-full px-3 py-2 border border-gbx-border text-sm font-data text-gbx-charcoal focus:border-gbx-teal focus:outline-none";
  const labelClass = "block text-xs font-body text-gbx-muted mb-1";

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
      <div className="flex items-start justify-between flex-wrap gap-4">
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
            onClick={() => {
              setShowTrade(!showTrade);
              setShowAdd(false);
            }}
            className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium border border-gbx-charcoal text-gbx-charcoal hover:bg-gbx-charcoal hover:text-white transition-colors"
          >
            {showTrade ? "Cancel" : "Record Trade"}
          </button>
          <button
            onClick={() => {
              setShowAdd(!showAdd);
              setShowTrade(false);
            }}
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
            {formatPercent(totalGainLossPercent)} on{" "}
            {formatCurrency(totalCost)} cost
          </p>
        </div>
        <div className="bg-white border border-gbx-border p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Realised Gain/Loss
          </p>
          <p
            className={`font-data text-2xl ${
              totalRealised >= 0 ? "text-gbx-teal" : "text-red-600"
            }`}
          >
            {totalRealised >= 0 ? "+" : ""}
            {formatCurrency(totalRealised)}
          </p>
          <p className="text-xs text-gbx-muted font-data mt-1">
            {trades.filter((t) => t.side === "sell").length} exit
            {trades.filter((t) => t.side === "sell").length !== 1 ? "s" : ""}
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

      {/* Record trade form */}
      {showTrade && (
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Record Trade
          </h2>
          <form onSubmit={handleAddTrade} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className={labelClass}>Side</label>
                <div className="flex border border-gbx-border">
                  {(["buy", "sell"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTradeForm((f) => ({ ...f, side: s }))}
                      className={`flex-1 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium transition-colors ${
                        tradeForm.side === s
                          ? s === "buy"
                            ? "bg-gbx-teal text-white"
                            : "bg-red-600 text-white"
                          : "bg-white text-gbx-muted hover:text-gbx-charcoal"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>Account</label>
                <select
                  value={tradeForm.account_id}
                  onChange={(e) =>
                    setTradeForm((f) => ({ ...f, account_id: e.target.value }))
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

              <div className="relative">
                <label className={labelClass}>Ticker</label>
                <input
                  type="text"
                  value={tradeForm.ticker || tradeQuery}
                  onChange={(e) => {
                    if (tradeForm.ticker) {
                      setTradeForm((f) => ({ ...f, ticker: "" }));
                    }
                    handleTradeSearch(e.target.value);
                  }}
                  placeholder="Search ticker"
                  required
                  className={inputClass}
                />
                {tradeResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gbx-border shadow-lg max-h-48 overflow-y-auto">
                    {tradeResults.map((r) => (
                      <button
                        key={r.symbol}
                        type="button"
                        onClick={() => selectTradeTicker(r)}
                        className="w-full text-left px-3 py-2 hover:bg-gbx-soft border-b border-gbx-border last:border-0"
                      >
                        <span className="font-data text-sm text-gbx-charcoal">
                          {r.symbol}
                        </span>
                        <span className="text-xs text-gbx-muted ml-2">
                          {r.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className={labelClass}>Trade Date</label>
                <input
                  type="date"
                  value={tradeForm.trade_date}
                  onChange={(e) =>
                    setTradeForm((f) => ({ ...f, trade_date: e.target.value }))
                  }
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Units</label>
                <input
                  type="number"
                  step="any"
                  value={tradeForm.units}
                  onChange={(e) =>
                    setTradeForm((f) => ({ ...f, units: e.target.value }))
                  }
                  required
                  placeholder="0"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>
                  {tradeForm.side === "buy" ? "Entry" : "Exit"} Price (per unit)
                </label>
                <input
                  type="number"
                  step="any"
                  value={tradeForm.price}
                  onChange={(e) =>
                    setTradeForm((f) => ({ ...f, price: e.target.value }))
                  }
                  required
                  placeholder="0.00"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Fees / Brokerage</label>
                <input
                  type="number"
                  step="any"
                  value={tradeForm.fees}
                  onChange={(e) =>
                    setTradeForm((f) => ({ ...f, fees: e.target.value }))
                  }
                  placeholder="0.00"
                  className={inputClass}
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingTrade}
                  className={`w-full px-4 py-2 text-white text-xs uppercase tracking-[0.15em] font-body font-medium transition-colors disabled:opacity-50 ${
                    tradeForm.side === "buy"
                      ? "bg-gbx-teal hover:bg-gbx-deep-teal"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {savingTrade
                    ? "Saving..."
                    : tradeForm.side === "buy"
                      ? "Record Buy"
                      : "Record Sell"}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-gbx-muted font-body">
              Recording a trade automatically updates the matching holding:
              buys increase units at average cost, sells reduce units and lock
              in realised gain/loss.
            </p>
          </form>
        </div>
      )}

      {/* Add holding form */}
      {showAdd && (
        <div className="bg-white border border-gbx-border p-6">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-4">
            Add New Holding
          </h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Account</label>
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

              <div className="relative">
                <label className={labelClass}>Ticker</label>
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
                  className={inputClass}
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

              <div>
                <label className={labelClass}>Units</label>
                <input
                  type="number"
                  step="any"
                  value={form.units}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, units: e.target.value }))
                  }
                  required
                  placeholder="0"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Cost Basis (per unit)</label>
                <input
                  type="number"
                  step="any"
                  value={form.cost_basis}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost_basis: e.target.value }))
                  }
                  placeholder="0.00"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Optional"
                  className={inputClass}
                />
              </div>

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
            No holdings yet. Record a trade or add a holding to start tracking.
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
                    {h.cached_price ? formatCurrency(h.cached_price) : "—"}
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
                      (h.gain_loss || 0) >= 0 ? "text-gbx-teal" : "text-red-600"
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

      {/* Performance */}
      {holdings.length > 0 && (
        <div className="bg-white border border-gbx-border p-6">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div>
              <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
                Performance
              </h2>
              {perf && (
                <p className="text-xs text-gbx-muted font-body mt-1">
                  {perf.from} to {perf.to}
                  {perf.portfolioReturn !== null && (
                    <span
                      className={`font-data ml-2 ${
                        perf.portfolioReturn >= 0
                          ? "text-gbx-teal"
                          : "text-red-600"
                      }`}
                    >
                      Portfolio {formatPercent(perf.portfolioReturn)}
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(
                [
                  ["1y", "1Y"],
                  ["3y", "3Y"],
                  ["5y", "5Y"],
                  ["all", "All Time"],
                  ["custom", "Custom"],
                ] as [PerfPeriod, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => selectPeriod(value)}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium border transition-colors ${
                    perfPeriod === value
                      ? "border-gbx-teal bg-gbx-teal text-white"
                      : "border-gbx-border text-gbx-muted hover:text-gbx-charcoal hover:border-gbx-teal"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {perfPeriod === "custom" && (
            <div className="flex items-end gap-3 mb-6 flex-wrap">
              <div>
                <label className={labelClass}>From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                onClick={() =>
                  customFrom &&
                  loadPerformance("custom", customFrom, customTo || undefined)
                }
                disabled={!customFrom}
                className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium bg-gbx-teal text-white hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          )}

          {perfLoading ? (
            <div className="h-64 flex items-center justify-center">
              <p className="text-gbx-muted font-body text-sm">
                Loading market history...
              </p>
            </div>
          ) : perf && perf.portfolio.length > 0 ? (
            <>
              <NetWorthChart data={perf.portfolio} label="Portfolio Value" />

              <div className="overflow-x-auto mt-6">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gbx-border">
                      {[
                        "Ticker",
                        "Name",
                        "Start Price",
                        "End Price",
                        "Return",
                        "Value Change",
                        "Vs Cost Basis",
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
                    {[...perf.perAsset]
                      .sort(
                        (a, b) =>
                          (b.changePercent ?? -Infinity) -
                          (a.changePercent ?? -Infinity)
                      )
                      .map((p) => (
                        <tr
                          key={p.ticker}
                          className="border-b border-gbx-border/50 hover:bg-gbx-soft/30 transition-colors"
                        >
                          <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal">
                            {p.ticker}
                          </td>
                          <td className="px-4 py-3 text-sm font-body text-gbx-charcoal max-w-[200px] truncate">
                            {p.name}
                          </td>
                          <td className="px-4 py-3 font-data text-sm text-gbx-muted">
                            {p.startPrice !== null
                              ? formatCurrency(p.startPrice)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                            {p.endPrice !== null
                              ? formatCurrency(p.endPrice)
                              : "—"}
                          </td>
                          <td
                            className={`px-4 py-3 font-data text-sm ${
                              (p.changePercent ?? 0) >= 0
                                ? "text-gbx-teal"
                                : "text-red-600"
                            }`}
                          >
                            {formatPercent(p.changePercent)}
                          </td>
                          <td
                            className={`px-4 py-3 font-data text-sm ${
                              (p.endValue ?? 0) - (p.startValue ?? 0) >= 0
                                ? "text-gbx-teal"
                                : "text-red-600"
                            }`}
                          >
                            {p.startValue !== null && p.endValue !== null ? (
                              <>
                                {p.endValue - p.startValue >= 0 ? "+" : ""}
                                {formatCurrency(p.endValue - p.startValue)}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td
                            className={`px-4 py-3 font-data text-sm ${
                              p.endPrice !== null &&
                              p.cost_basis > 0 &&
                              p.endPrice >= p.cost_basis
                                ? "text-gbx-teal"
                                : "text-red-600"
                            }`}
                          >
                            {p.endPrice !== null && p.cost_basis > 0
                              ? formatPercent(
                                  ((p.endPrice - p.cost_basis) /
                                    p.cost_basis) *
                                    100
                                )
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="h-32 flex items-center justify-center">
              <p className="text-gbx-muted font-body text-sm">
                No market history available for this period.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Trade history */}
      <div className="bg-white border border-gbx-border">
        <div className="px-6 pt-6 pb-4 flex items-baseline justify-between">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
            Trade History
          </h2>
          {trades.length > 0 && (
            <p className="text-xs font-body text-gbx-muted">
              Total realised:{" "}
              <span
                className={`font-data ${
                  totalRealised >= 0 ? "text-gbx-teal" : "text-red-600"
                }`}
              >
                {totalRealised >= 0 ? "+" : ""}
                {formatCurrency(totalRealised)}
              </span>
            </p>
          )}
        </div>
        {trades.length === 0 ? (
          <p className="px-6 pb-6 text-gbx-muted font-body text-sm">
            No trades recorded yet. Use “Record Trade” to log buys and sells
            with entry and exit prices.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-gbx-border">
                  {[
                    "Date",
                    "Side",
                    "Ticker",
                    "Account",
                    "Units",
                    "Price",
                    "Fees",
                    "Total",
                    "Realised P&L",
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
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-gbx-border/50 hover:bg-gbx-soft/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                      {t.trade_date}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] uppercase tracking-[0.15em] font-body font-medium px-2 py-0.5 ${
                          t.side === "buy"
                            ? "bg-gbx-teal/10 text-gbx-teal"
                            : "bg-red-600/10 text-red-600"
                        }`}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal">
                      {t.ticker}
                    </td>
                    <td className="px-4 py-3 text-xs font-body text-gbx-muted">
                      {t.account_name}
                    </td>
                    <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                      {t.units.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                      {formatCurrency(t.price)}
                    </td>
                    <td className="px-4 py-3 font-data text-sm text-gbx-muted">
                      {t.fees > 0 ? formatCurrency(t.fees) : "—"}
                    </td>
                    <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">
                      {formatCurrency(t.total_value)}
                    </td>
                    <td className="px-4 py-3 font-data text-sm">
                      {t.realised !== null ? (
                        <span
                          className={
                            t.realised >= 0 ? "text-gbx-teal" : "text-red-600"
                          }
                        >
                          {t.realised >= 0 ? "+" : ""}
                          {formatCurrency(t.realised)}
                          {t.avg_cost_at_sale !== null && (
                            <span className="text-[10px] text-gbx-muted ml-1">
                              (avg cost {formatCurrency(t.avg_cost_at_sale)})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gbx-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteTrade(t.id)}
                        className="text-xs text-gbx-muted hover:text-red-600 font-body transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
