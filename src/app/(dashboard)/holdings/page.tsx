"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import NetWorthChart from "@/components/NetWorthChart";

interface Holding {
  id: string;
  account_id: string;
  account_name: string;
  account_owner: string;
  pct_p1: number | null;
  effective_pct_p1: number;
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
  portfolio: { date: string; total: number; benchmark?: number | null }[];
  portfolioReturn: number | null;
  benchmarkReturn: number | null;
  moneyWeightedReturn: number | null;
}

type PerfPeriod = "1y" | "3y" | "5y" | "all" | "custom";

interface MovementRow {
  ticker: string;
  name: string;
  units: number;
  value: number | null;
  m24h: number | null;
  m7d: number | null;
  m1m: number | null;
  m3m: number | null;
}
interface MovementTotal {
  abs: number;
  pct: number;
}
interface MovementData {
  holdings: MovementRow[];
  totals: ({ value: number } & Record<string, MovementTotal | null>) | null;
  asOf: string | null;
}

const MOVE_COLS: { key: keyof MovementRow; label: string }[] = [
  { key: "m24h", label: "24h" },
  { key: "m7d", label: "7d" },
  { key: "m1m", label: "1M" },
  { key: "m3m", label: "3M" },
];

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

// Crypto positions in this app are quoted against a fiat pair (e.g. XRP-AUD,
// BONK-USD); listed securities use an exchange suffix (.AX) or a plain symbol.
function isCrypto(ticker: string): boolean {
  return /-(USD|AUD|USDT|EUR|GBP)$/i.test(ticker || "");
}

type KindFilter = "all" | "listed" | "crypto";

function passesKind(ticker: string, f: KindFilter): boolean {
  if (f === "all") return true;
  return f === "crypto" ? isCrypto(ticker) : !isCrypto(ticker);
}

// A small dot before a ticker: warm gold for crypto, teal for listed.
function KindDot({ ticker }: { ticker: string }) {
  const c = isCrypto(ticker);
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle shrink-0"
      style={{ background: c ? "#C68A2E" : "#2E8B6E" }}
      title={c ? "Crypto" : "Listed"}
    />
  );
}

// Compact All / Listed / Crypto filter for a card.
function KindSelect({
  value,
  onChange,
}: {
  value: KindFilter;
  onChange: (v: KindFilter) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as KindFilter)}
      className="bg-white border border-gbx-border text-[11px] uppercase tracking-[0.1em] font-body text-gbx-muted px-2 py-1.5 focus:outline-none focus:border-gbx-teal cursor-pointer"
    >
      <option value="all">All assets</option>
      <option value="listed">Listed</option>
      <option value="crypto">Crypto</option>
    </select>
  );
}

type ColSort = { key: string; dir: 1 | -1 };

// Generic column sort: nulls sink, strings collate, numbers compare.
function sortRows<T>(rows: T[], sort: ColSort | null, stringKeys: string[]): T[] {
  if (!sort) return rows;
  const arr = [...rows];
  const isStr = stringKeys.includes(sort.key);
  arr.sort((a, b) => {
    const av = (a as Record<string, unknown>)[sort.key];
    const bv = (b as Record<string, unknown>)[sort.key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (isStr ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv)) * sort.dir;
  });
  return arr;
}

// Toggle helper: same column flips direction; a new column starts ascending for
// text and descending (largest-first) for numbers.
function makeToggle(
  set: React.Dispatch<React.SetStateAction<ColSort | null>>,
  stringKeys: string[]
) {
  return (key: string) =>
    set((s) =>
      s && s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: stringKeys.includes(key) ? 1 : -1 }
    );
}

// A clickable table header cell that shows the active sort arrow. Pass the
// column's base cell classes (alignment/padding/typography) via `className`.
function SortTh({
  label,
  k,
  className = "",
  sort,
  onSort,
}: {
  label: string;
  k?: string;
  className?: string;
  sort: ColSort | null;
  onSort: (k: string) => void;
}) {
  const active = !!k && sort?.key === k;
  return (
    <th
      onClick={k ? () => onSort(k) : undefined}
      className={`${className} ${
        k
          ? "cursor-pointer select-none hover:text-gbx-charcoal " +
            (active ? "text-gbx-teal" : "text-gbx-muted")
          : "text-gbx-muted"
      }`}
    >
      {label}
      {active && <span className="ml-1">{sort!.dir === 1 ? "▲" : "▼"}</span>}
    </th>
  );
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
    pct_p1: "",
  });

  const [users, setUsers] = useState({ person1: "Person 1", person2: "Person 2" });

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

  // Table sorting
  const [sortKey, setSortKey] = useState<string>("ticker");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  // Section layout (per-user, from Settings)
  const [sectionOrder, setSectionOrder] = useState<string[]>([
    "summary", "holdings", "performance", "trades",
  ]);
  const orderOf = (id: string) => {
    const i = sectionOrder.indexOf(id);
    return i === -1 ? 99 : 10 + i;
  };

  // Performance
  const [perf, setPerf] = useState<PerfData | null>(null);
  const [perfPeriod, setPerfPeriod] = useState<PerfPeriod>("1y");
  const [perfLoading, setPerfLoading] = useState(false);
  const [movement, setMovement] = useState<MovementData | null>(null);
  const [movementLoading, setMovementLoading] = useState(false);
  // Each Holdings-tab table collapses to its top 5 rows by default.
  const [expandHoldings, setExpandHoldings] = useState(false);
  const [expandMovement, setExpandMovement] = useState(false);
  const [expandPerf, setExpandPerf] = useState(false);
  const [expandTrades, setExpandTrades] = useState(false);
  // Per-table column sort (null = the table's natural default order).
  const [moveSort, setMoveSort] = useState<ColSort | null>(null);
  const [perfSort, setPerfSort] = useState<ColSort | null>(null);
  const [tradeSort, setTradeSort] = useState<ColSort | null>(null);
  // Per-card asset-class filter (all / listed / crypto).
  const [holdingsFilter, setHoldingsFilter] = useState<KindFilter>("all");
  const [moveFilter, setMoveFilter] = useState<KindFilter>("all");
  const [perfFilter, setPerfFilter] = useState<KindFilter>("all");
  const [tradeFilter, setTradeFilter] = useState<KindFilter>("all");
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

  const loadMovement = useCallback(async () => {
    setMovementLoading(true);
    try {
      const res = await fetch("/api/holdings/movement");
      const data = await res.json();
      if (!data.error) setMovement(data);
    } finally {
      setMovementLoading(false);
    }
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
    fetch("/api/prefs")
      .then((r) => r.json())
      .then((p) => {
        if (Array.isArray(p?.holdingsOrder)) setSectionOrder(p.holdingsOrder);
      })
      .catch(() => {});
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
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
      if (h.length > 0) {
        loadPerformance("1y");
        loadMovement();
      }
    });
  }, [loadPerformance, loadMovement]);

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
        pct_p1: form.pct_p1 === "" ? null : parseFloat(form.pct_p1),
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
      pct_p1: "",
    });
    setShowAdd(false);
    await loadHoldings();
  }

  async function handlePctChange(id: string, pct_p1: number | null) {
    setHoldings((hs) =>
      hs.map((h) => (h.id === id ? { ...h, pct_p1 } : h))
    );
    await fetch("/api/holdings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pct_p1 }),
    });
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

  // The holdings table (and its footer totals) respect its asset-class filter.
  const filteredHoldings = holdings.filter((h) =>
    passesKind(h.ticker, holdingsFilter)
  );
  const totalMarketValue = filteredHoldings.reduce(
    (sum, h) => sum + (h.market_value || 0),
    0
  );
  const totalCost = filteredHoldings.reduce((sum, h) => sum + h.total_cost, 0);
  const totalGainLoss = totalMarketValue - totalCost;
  const totalGainLossPercent =
    totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
  const totalAnnualIncome = filteredHoldings.reduce(
    (sum, h) => sum + (h.annual_income || 0),
    0
  );
  const lastUpdated = holdings.find((h) => h.price_updated_at)?.price_updated_at;

  const STRING_SORT_KEYS = ["ticker", "display_name", "account_name"];

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      // Strings read best ascending; numbers best largest-first.
      setSortDir(STRING_SORT_KEYS.includes(key) ? 1 : -1);
    }
  }

  const sortedHoldings = useMemo(() => {
    const arr = holdings.filter((h) => passesKind(h.ticker, holdingsFilter));
    const isString = STRING_SORT_KEYS.includes(sortKey);
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (isString) return String(av).localeCompare(String(bv)) * sortDir;
      return (Number(av) - Number(bv)) * sortDir;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, sortKey, sortDir, holdingsFilter]);

  // Performance rows enriched with the derived columns so those are sortable
  // too; default order is best-return-first when no column is chosen.
  const perfSorted = (() => {
    const enriched = (perf?.perAsset ?? [])
      .filter((p) => passesKind(p.ticker, perfFilter))
      .map((p) => ({
        ...p,
        valueChange:
          p.endValue != null && p.startValue != null ? p.endValue - p.startValue : null,
        vsCost:
          p.endPrice != null && p.cost_basis > 0
            ? ((p.endPrice - p.cost_basis) / p.cost_basis) * 100
            : null,
      }));
    return perfSort
      ? sortRows(enriched, perfSort, ["ticker", "name"])
      : enriched.sort(
          (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity)
        );
  })();

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
    <div className="flex flex-col gap-8">
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
        <div className="flex gap-2 sm:gap-3 flex-wrap">
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" style={{ order: orderOf("summary") }}>
        <div className="bg-gbx-charcoal border border-white/5 p-4 sm:p-6 col-span-2 lg:col-span-1">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal mb-1">
            Portfolio Value
          </p>
          <p className="font-data text-2xl sm:text-3xl text-white break-words">
            {formatCurrency(totalMarketValue)}
          </p>
          <p className="text-xs text-white/40 font-body mt-1">
            {holdings.length} holding{holdings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="bg-white border border-gbx-border p-4 sm:p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Unrealised Gain/Loss
          </p>
          <p
            className={`font-data text-lg sm:text-2xl break-words ${
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
        <div className="bg-white border border-gbx-border p-4 sm:p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Realised Gain/Loss
          </p>
          <p
            className={`font-data text-lg sm:text-2xl break-words ${
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
        <div className="bg-white border border-gbx-border p-4 sm:p-6">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">
            Annual Dividend Income
          </p>
          <p className="font-data text-lg sm:text-2xl break-words text-gbx-teal">
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
        <div className="bg-white border border-gbx-border p-4 sm:p-6" style={{ order: 1 }}>
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
        <div className="bg-white border border-gbx-border p-4 sm:p-6" style={{ order: 2 }}>
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
                <label className={labelClass}>
                  % owned by {users.person1.split(" ")[0]}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.pct_p1}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pct_p1: e.target.value }))
                  }
                  placeholder="Blank = same as account"
                  className={inputClass}
                />
                {form.pct_p1 !== "" && (
                  <p className="text-[11px] text-gbx-muted font-body mt-1">
                    {form.pct_p1}% {users.person1.split(" ")[0]} ·{" "}
                    {100 - (parseFloat(form.pct_p1) || 0)}%{" "}
                    {users.person2.split(" ")[0]}
                  </p>
                )}
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
        <div className="bg-white border border-gbx-border p-12 text-center" style={{ order: orderOf("holdings") }}>
          <p className="text-gbx-muted font-body text-sm">
            No holdings yet. Record a trade or add a holding to start tracking.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gbx-border" style={{ order: orderOf("holdings") }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gbx-border">
            <span className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">
              Holdings
            </span>
            <KindSelect value={holdingsFilter} onChange={setHoldingsFilter} />
          </div>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gbx-border">
                {([
                  ["Ticker", "", "ticker"],
                  ["Name", "hidden xl:table-cell", "display_name"],
                  ["Account", "hidden lg:table-cell", "account_name"],
                  [`Owner split`, "hidden sm:table-cell", "effective_pct_p1"],
                  ["Units", "hidden sm:table-cell", "units"],
                  ["Price", "hidden md:table-cell", "cached_price"],
                  ["Day %", "hidden lg:table-cell", "cached_change_percent"],
                  ["Market Value", "", "market_value"],
                  ["Cost Basis", "hidden xl:table-cell", "total_cost"],
                  ["Gain/Loss", "", "gain_loss_percent"],
                  ["Div Yield", "hidden xl:table-cell", "cached_dividend_yield"],
                  ["Annual Income", "hidden md:table-cell", "annual_income"],
                  ["", "", ""],
                ] as [string, string, string][]).map(([h, cls, key], i) => (
                  <th
                    key={i}
                    onClick={key ? () => toggleSort(key) : undefined}
                    className={`px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] font-body font-medium ${cls} ${
                      key
                        ? "cursor-pointer select-none hover:text-gbx-charcoal " +
                          (sortKey === key ? "text-gbx-teal" : "text-gbx-muted")
                        : "text-gbx-muted"
                    }`}
                  >
                    {h}
                    {key && sortKey === key && (
                      <span className="ml-1">{sortDir === 1 ? "\u25B2" : "\u25BC"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(expandHoldings ? sortedHoldings : sortedHoldings.slice(0, 5)).map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-gbx-border/50 hover:bg-gbx-soft/30 transition-colors"
                >
                  <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal whitespace-nowrap">
                    <KindDot ticker={h.ticker} />
                    {h.ticker}
                  </td>
                  <td className="hidden xl:table-cell px-4 py-3 text-sm font-body text-gbx-charcoal max-w-[200px] truncate">
                    {h.display_name}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-3 text-xs font-body text-gbx-muted">
                    {h.account_name}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={
                          h.pct_p1 !== null
                            ? h.pct_p1
                            : Math.round(h.effective_pct_p1)
                        }
                        onChange={(e) =>
                          handlePctChange(
                            h.id,
                            e.target.value === "" ? null : parseFloat(e.target.value)
                          )
                        }
                        className={`w-14 border border-gbx-border text-xs font-data px-1.5 py-1 bg-white ${
                          h.pct_p1 !== null ? "text-gbx-charcoal" : "text-gbx-muted"
                        }`}
                        title={`% owned by ${users.person1}; the rest is ${users.person2}'s`}
                      />
                      <span className="text-[10px] font-body text-gbx-muted leading-tight">
                        {Math.round(h.effective_pct_p1)}% {users.person1.split(" ")[0]}
                        <br />
                        {100 - Math.round(h.effective_pct_p1)}% {users.person2.split(" ")[0]}
                      </span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 font-data text-sm text-gbx-charcoal">
                    {h.units.toLocaleString()}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 font-data text-sm text-gbx-charcoal">
                    {h.cached_price ? formatCurrency(h.cached_price) : "—"}
                  </td>
                  <td
                    className={`hidden lg:table-cell px-4 py-3 font-data text-sm ${
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
                  <td className="hidden xl:table-cell px-4 py-3 font-data text-sm text-gbx-muted">
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
                  <td className="hidden xl:table-cell px-4 py-3 font-data text-sm text-gbx-charcoal">
                    {h.cached_dividend_yield !== null
                      ? `${h.cached_dividend_yield.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 font-data text-sm text-gbx-teal">
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
                <td className="px-4 py-3 text-xs uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">
                  Totals
                </td>
                <td className="hidden xl:table-cell" />
                <td className="hidden lg:table-cell" />
                <td className="hidden sm:table-cell" />
                <td className="hidden sm:table-cell" />
                <td className="hidden md:table-cell" />
                <td className="hidden lg:table-cell" />
                <td className="px-4 py-3 font-data text-sm font-bold text-gbx-charcoal">
                  {formatCurrency(totalMarketValue)}
                </td>
                <td className="hidden xl:table-cell px-4 py-3 font-data text-sm text-gbx-muted">
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
                <td className="hidden xl:table-cell" />
                <td className="hidden md:table-cell px-4 py-3 font-data text-sm font-bold text-gbx-teal">
                  {formatCurrency(totalAnnualIncome)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          {sortedHoldings.length > 5 && (
            <button
              onClick={() => setExpandHoldings((v) => !v)}
              className="w-full px-4 py-2.5 text-[11px] text-gbx-teal uppercase tracking-[0.12em] font-body font-medium hover:bg-gbx-soft/40 border-t border-gbx-border transition-colors"
            >
              {expandHoldings ? "Show less" : `Show all ${sortedHoldings.length}`}
            </button>
          )}
          {lastUpdated && (
            <p className="px-4 py-2 text-[10px] text-gbx-muted font-body border-t border-gbx-border/50">
              Prices last updated:{" "}
              {new Date(lastUpdated + "Z").toLocaleString("en-AU")}
            </p>
          )}
          </div>
        </div>
      )}

      {/* Performance */}
      {holdings.length > 0 && (
        <div className="bg-white border border-gbx-border p-4 sm:p-6 flex flex-col" style={{ order: orderOf("performance") }}>
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div>
              <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
                Performance
              </h2>
              {perf && (
                <p className="text-xs text-gbx-muted font-body mt-1">
                  {perf.from} to {perf.to}
                  {perf.benchmarkReturn !== null && (
                    <span
                      className="font-data ml-2 text-gbx-muted"
                      title="A 70/30 growth benchmark (70% shares, 30% bonds), over the selected period"
                    >
                      Benchmark (70/30) {formatPercent(perf.benchmarkReturn)}
                    </span>
                  )}
                  {perf.moneyWeightedReturn !== null && (
                    <span
                      className={`font-data ml-2 ${
                        perf.moneyWeightedReturn >= 0
                          ? "text-gbx-teal"
                          : "text-red-600"
                      }`}
                      title="Money-weighted (XIRR) return of your actual trades over the selected period, annualised"
                    >
                      · Your return {formatPercent(perf.moneyWeightedReturn)}{" "}
                      p.a.
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
              <KindSelect value={perfFilter} onChange={setPerfFilter} />
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

          {/* Movement over 24h / 7d / 1M / 3M — independent of the period picker.
              order:1 keeps it below the chart, which stays under the toggles. */}
          <div className="mt-8" style={{ order: 1 }}>
            <div className="flex items-center justify-between mb-3 gap-3">
              <h3 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">
                Movement
              </h3>
              <div className="flex items-center gap-3">
                {movement?.asOf && (
                  <span className="text-[10px] text-gbx-muted font-data hidden sm:inline">as of {movement.asOf}</span>
                )}
                <KindSelect value={moveFilter} onChange={setMoveFilter} />
              </div>
            </div>
            {movementLoading && !movement ? (
              <p className="text-gbx-muted font-body text-sm py-4">Loading movement…</p>
            ) : movement && movement.holdings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gbx-border">
                      <SortTh label="Holding" k="ticker" sort={moveSort} onSort={makeToggle(setMoveSort, ["ticker"])} className="text-left py-2 pr-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium" />
                      <SortTh label="Value" k="value" sort={moveSort} onSort={makeToggle(setMoveSort, ["ticker"])} className="hidden sm:table-cell text-right py-2 px-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium" />
                      {MOVE_COLS.map((c) => (
                        <SortTh key={c.key} label={c.label} k={c.key} sort={moveSort} onSort={makeToggle(setMoveSort, ["ticker"])} className="text-right py-2 px-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium" />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movement.totals && moveFilter === "all" && (
                      <tr className="border-b border-gbx-border bg-gbx-soft/40">
                        <td className="py-2.5 pr-3 font-body font-medium text-gbx-charcoal">Portfolio</td>
                        <td className="hidden sm:table-cell py-2.5 px-3 text-right font-data text-gbx-charcoal">{formatCurrency(movement.totals.value)}</td>
                        {MOVE_COLS.map((c) => {
                          const t = movement.totals?.[c.key] as MovementTotal | null | undefined;
                          return (
                            <td key={c.key} className={`py-2.5 px-3 text-right font-data ${t ? (t.pct >= 0 ? "text-gbx-teal" : "text-red-600") : "text-gbx-muted"}`}>
                              {t ? formatPercent(t.pct) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                    {sortRows(movement.holdings.filter((h) => passesKind(h.ticker, moveFilter)), moveSort, ["ticker"]).slice(0, expandMovement ? undefined : 5).map((h) => (
                      <tr key={h.ticker} className="border-b border-gbx-border/50">
                        <td className="py-2.5 pr-3 font-data text-gbx-charcoal whitespace-nowrap"><KindDot ticker={h.ticker} />{h.ticker.replace(/\.AX$/, "")}</td>
                        <td className="hidden sm:table-cell py-2.5 px-3 text-right font-data text-gbx-muted">{h.value != null ? formatCurrency(h.value) : "—"}</td>
                        {MOVE_COLS.map((c) => {
                          const v = h[c.key] as number | null;
                          return (
                            <td key={c.key} className={`py-2.5 px-3 text-right font-data ${v != null ? (v >= 0 ? "text-gbx-teal" : "text-red-600") : "text-gbx-muted"}`}>
                              {v != null ? formatPercent(v) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {movement.holdings.filter((h) => passesKind(h.ticker, moveFilter)).length > 5 && (
                  <button
                    onClick={() => setExpandMovement((v) => !v)}
                    className="w-full py-2.5 text-[11px] text-gbx-teal uppercase tracking-[0.12em] font-body font-medium hover:bg-gbx-soft/40 border-t border-gbx-border transition-colors"
                  >
                    {expandMovement ? "Show less" : `Show all ${movement.holdings.filter((h) => passesKind(h.ticker, moveFilter)).length}`}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-gbx-muted font-body text-sm py-4">No movement data yet.</p>
            )}
          </div>

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
                      {([
                        ["Ticker", "", "ticker"],
                        ["Name", "hidden lg:table-cell", "name"],
                        ["Start Price", "hidden md:table-cell", "startPrice"],
                        ["End Price", "hidden sm:table-cell", "endPrice"],
                        ["Return", "", "changePercent"],
                        ["Value Change", "", "valueChange"],
                        ["Vs Cost Basis", "hidden md:table-cell", "vsCost"],
                      ] as [string, string, string][]).map(([h, cls, key]) => (
                        <SortTh
                          key={h}
                          label={h}
                          k={key}
                          sort={perfSort}
                          onSort={makeToggle(setPerfSort, ["ticker", "name"])}
                          className={`px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] font-body font-medium ${cls}`}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {perfSorted
                      .slice(0, expandPerf ? undefined : 5)
                      .map((p) => (
                        <tr
                          key={p.ticker}
                          className="border-b border-gbx-border/50 hover:bg-gbx-soft/30 transition-colors"
                        >
                          <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal whitespace-nowrap">
                            <KindDot ticker={p.ticker} />
                            {p.ticker}
                          </td>
                          <td className="hidden lg:table-cell px-4 py-3 text-sm font-body text-gbx-charcoal max-w-[200px] truncate">
                            {p.name}
                          </td>
                          <td className="hidden md:table-cell px-4 py-3 font-data text-sm text-gbx-muted">
                            {p.startPrice !== null
                              ? formatCurrency(p.startPrice)
                              : "—"}
                          </td>
                          <td className="hidden sm:table-cell px-4 py-3 font-data text-sm text-gbx-charcoal">
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
                            className={`hidden md:table-cell px-4 py-3 font-data text-sm ${
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
              {perfSorted.length > 5 && (
                <button
                  onClick={() => setExpandPerf((v) => !v)}
                  className="w-full mt-2 py-2.5 text-[11px] text-gbx-teal uppercase tracking-[0.12em] font-body font-medium hover:bg-gbx-soft/40 border-t border-gbx-border transition-colors"
                >
                  {expandPerf ? "Show less" : `Show all ${perfSorted.length}`}
                </button>
              )}
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
      <div className="bg-white border border-gbx-border" style={{ order: orderOf("trades") }}>
        <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
            Trade History
          </h2>
          <div className="flex items-center gap-3">
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
            <KindSelect value={tradeFilter} onChange={setTradeFilter} />
          </div>
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
                  {([
                    ["Date", "", "trade_date"],
                    ["Side", "", "side"],
                    ["Ticker", "", "ticker"],
                    ["Account", "hidden lg:table-cell", "account_name"],
                    ["Units", "hidden sm:table-cell", "units"],
                    ["Price", "hidden sm:table-cell", "price"],
                    ["Fees", "hidden xl:table-cell", "fees"],
                    ["Total", "", "total_value"],
                    ["Realised P&L", "", "realised"],
                    ["", "", ""],
                  ] as [string, string, string][]).map(([h, cls, key], i) => (
                    <SortTh
                      key={i}
                      label={h}
                      k={key || undefined}
                      sort={tradeSort}
                      onSort={makeToggle(setTradeSort, ["trade_date", "side", "ticker", "account_name"])}
                      className={`px-4 py-3 text-left text-[10px] uppercase tracking-[0.15em] font-body font-medium ${cls}`}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortRows(trades.filter((t) => passesKind(t.ticker, tradeFilter)), tradeSort, ["trade_date", "side", "ticker", "account_name"]).slice(0, expandTrades ? undefined : 5).map((t) => (
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
                    <td className="px-4 py-3 font-data text-sm font-medium text-gbx-charcoal whitespace-nowrap">
                      <KindDot ticker={t.ticker} />
                      {t.ticker}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-xs font-body text-gbx-muted">
                      {t.account_name}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 font-data text-sm text-gbx-charcoal">
                      {t.units.toLocaleString()}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 font-data text-sm text-gbx-charcoal">
                      {formatCurrency(t.price)}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-3 font-data text-sm text-gbx-muted">
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
            {trades.filter((t) => passesKind(t.ticker, tradeFilter)).length > 5 && (
              <button
                onClick={() => setExpandTrades((v) => !v)}
                className="w-full py-2.5 text-[11px] text-gbx-teal uppercase tracking-[0.12em] font-body font-medium hover:bg-gbx-soft/40 border-t border-gbx-border transition-colors"
              >
                {expandTrades ? "Show less" : `Show all ${trades.filter((t) => passesKind(t.ticker, tradeFilter)).length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
