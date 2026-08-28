"use client";

import { useEffect, useMemo, useState } from "react";

interface Account {
  id: string;
  name: string;
  type: string;
}
interface Category {
  id: string;
  name: string;
  type: string;
}

interface TxnRow {
  date: string;
  description: string;
  amount: number;
  category: string | null;
}
interface TradeRow {
  trade_date: string;
  ticker: string;
  side: "buy" | "sell";
  units: number;
  price: number;
  fees: number;
}
interface HoldingRow {
  ticker: string;
  name: string;
  units: number;
  price: number;
  value: number;
}

interface AnalyzeResult {
  kind: "transactions" | "trades" | "holdings";
  source: string;
  label: string;
  fileName: string;
  transactions?: TxnRow[];
  trades?: TradeRow[];
  holdings?: HoldingRow[];
  cash?: number | null;
  warnings: string[];
}

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";
const labelClass =
  "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(value);
}

export default function ImportPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [categoryOverrides, setCategoryOverrides] = useState<Record<number, string>>({});
  const [usMarket, setUsMarket] = useState(false);

  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
    fetch("/api/categories").then((r) => r.json()).then(setCategories).catch(() => {});
  }, []);

  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  function resetPreview() {
    setResult(null);
    setExcluded(new Set());
    setCategoryOverrides({});
    setUsMarket(false);
    setError("");
    setMessage(null);
  }

  async function handleFile(file: File) {
    resetPreview();
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not analyse the file.");
        return;
      }
      setResult(data);
    } catch {
      setError("Could not read that file.");
    } finally {
      setAnalyzing(false);
    }
  }

  function toggle(i: number) {
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  const rowsLength = result
    ? result.kind === "transactions"
      ? result.transactions!.length
      : result.kind === "trades"
        ? result.trades!.length
        : result.holdings!.length
    : 0;
  const includedCount = rowsLength - excluded.size;

  function applyMarket(ticker: string): string {
    if (!usMarket) return ticker;
    return ticker.endsWith(".AX") ? ticker.slice(0, -3) : ticker;
  }

  async function handleImport() {
    if (!result || !accountId) return;
    setImporting(true);
    setMessage(null);
    try {
      let res: Response;
      if (result.kind === "transactions") {
        const rows = result.transactions!.filter((_, i) => !excluded.has(i));
        res = await fetch("/api/transactions/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            transactions: rows.map((r, i) => ({
              date: r.date,
              amount: r.amount,
              description: r.description,
              category: categoryOverrides[i] ?? r.category,
            })),
          }),
        });
      } else if (result.kind === "trades") {
        const rows = result.trades!.filter((_, i) => !excluded.has(i));
        res = await fetch("/api/trades/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            trades: rows.map((r) => ({ ...r, ticker: applyMarket(r.ticker) })),
          }),
        });
      } else {
        const rows = result.holdings!.filter((_, i) => !excluded.has(i));
        res = await fetch("/api/holdings/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            holdings: rows.map((r) => ({
              ticker: applyMarket(r.ticker),
              name: r.name || null,
              units: r.units,
              cost_basis: r.price,
            })),
            cash: result.cash ?? null,
          }),
        });
      }
      const data = await res.json();
      if (data.error) {
        setMessage(`Import failed: ${data.error}`);
      } else if (result.kind === "transactions") {
        setMessage(`Imported ${data.imported} transactions (${data.skipped} skipped).`);
        resetPreview();
      } else if (result.kind === "trades") {
        setMessage(
          `Imported ${data.imported} trades (${data.skipped} skipped). Holdings updated.${
            data.reconciled
              ? ` Reconciled ${data.reconciled} position${data.reconciled !== 1 ? "s" : ""} to the statement (DRP top-up).`
              : ""
          }`
        );
        resetPreview();
      } else {
        setMessage(
          `Imported ${data.imported} new holdings, updated ${data.updated}.${
            data.reconciled
              ? ` Reconciled ${data.reconciled} traded position${data.reconciled !== 1 ? "s" : ""} to the statement units, keeping the trade cost basis.`
              : " Cost basis seeded from the statement — edit a holding to set the real entry price."
          }`
        );
        resetPreview();
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal">Import</h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          Drop in any statement — bank CSV, brokerage trade history, or a
          holdings valuation (CSV or PDF). It identifies the document and routes
          it automatically.
        </p>
      </div>

      <div className="bg-white border border-gbx-border p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Into account</label>
            <select
              className={inputClass}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Statement file (CSV or PDF)</label>
            <input
              type="file"
              accept=".csv,.pdf,text/csv,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="w-full text-sm font-body text-gbx-charcoal file:mr-3 file:px-4 file:py-2 file:border file:border-gbx-teal file:bg-white file:text-gbx-teal file:text-[11px] file:uppercase file:tracking-[0.1em] file:font-medium file:cursor-pointer"
            />
          </div>
        </div>

        {analyzing && (
          <p className="text-sm text-gbx-muted font-body">Identifying document...</p>
        )}
        {error && <p className="text-sm text-red-600 font-body">{error}</p>}
        {message && (
          <p className="text-sm text-gbx-teal font-body font-medium">{message}</p>
        )}
      </div>

      {result && (
        <div className="bg-white border border-gbx-border">
          <div className="px-4 sm:px-6 pt-5 pb-3 flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.15em] font-body font-medium bg-gbx-teal/10 text-gbx-teal px-2 py-1">
                  Detected
                </span>
                <h2 className="text-sm font-body font-medium text-gbx-charcoal">
                  {result.label}
                </h2>
              </div>
              <p className="text-[11px] text-gbx-muted font-body mt-1">
                {result.fileName} · {includedCount} of {rowsLength} rows selected
                {result.kind === "holdings" &&
                  result.cash != null &&
                  ` · cash ${formatCurrency(result.cash)} will be recorded`}
              </p>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-gbx-muted font-body mt-1">
                  ⚠ {w}
                </p>
              ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {result.kind !== "transactions" && (
                <label className="flex items-center gap-1.5 text-[11px] font-body text-gbx-muted">
                  <input
                    type="checkbox"
                    checked={usMarket}
                    onChange={(e) => setUsMarket(e.target.checked)}
                  />
                  US tickers (drop .AX)
                </label>
              )}
              <button
                onClick={handleImport}
                disabled={importing || !accountId || includedCount === 0}
                className="px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
              >
                {importing ? "Importing..." : `Import ${includedCount}`}
              </button>
            </div>
          </div>
          {!accountId && (
            <p className="px-4 sm:px-6 pb-2 text-[11px] text-red-600 font-body">
              Select an account above first.
            </p>
          )}

          <div className="overflow-x-auto">
            {result.kind === "transactions" && (
              <table className="w-full">
                <thead>
                  <tr className="border-y border-gbx-border">
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">Date</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">Description</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted hidden sm:table-cell">Category</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.transactions!.map((r, i) => (
                    <tr key={i} className={`border-b border-gbx-border/50 ${excluded.has(i) ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={!excluded.has(i)} onChange={() => toggle(i)} />
                      </td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-2 text-xs font-body text-gbx-charcoal max-w-[240px] truncate">{r.description}</td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <select
                          value={categoryOverrides[i] ?? r.category ?? ""}
                          onChange={(e) => setCategoryOverrides((c) => ({ ...c, [i]: e.target.value }))}
                          className="border border-gbx-border text-xs font-body px-2 py-1 bg-white text-gbx-charcoal"
                        >
                          <option value="">—</option>
                          {categoryNames.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className={`px-3 py-2 text-right font-data text-xs whitespace-nowrap ${r.amount >= 0 ? "text-gbx-teal" : "text-red-600"}`}>
                        {r.amount >= 0 ? "+" : ""}{formatCurrency(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {result.kind === "trades" && (
              <table className="w-full">
                <thead>
                  <tr className="border-y border-gbx-border">
                    <th className="px-3 py-2 w-8" />
                    {["Date", "Ticker", "Side", "Units", "Price", "Fees", "Total"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.trades!.map((r, i) => (
                    <tr key={i} className={`border-b border-gbx-border/50 ${excluded.has(i) ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={!excluded.has(i)} onChange={() => toggle(i)} />
                      </td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal whitespace-nowrap">{r.trade_date}</td>
                      <td className="px-3 py-2 font-data text-xs font-medium text-gbx-charcoal">{applyMarket(r.ticker)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] uppercase tracking-[0.12em] font-body font-medium px-1.5 py-0.5 ${r.side === "buy" ? "bg-gbx-teal/10 text-gbx-teal" : "bg-red-600/10 text-red-600"}`}>{r.side}</span>
                      </td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{r.units.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{formatCurrency(r.price)}</td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-muted">{r.fees ? formatCurrency(r.fees) : "—"}</td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{formatCurrency(r.units * r.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {result.kind === "holdings" && (
              <table className="w-full">
                <thead>
                  <tr className="border-y border-gbx-border">
                    <th className="px-3 py-2 w-8" />
                    {["Ticker", "Name", "Units", "Price", "Value"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.holdings!.map((r, i) => (
                    <tr key={i} className={`border-b border-gbx-border/50 ${excluded.has(i) ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={!excluded.has(i)} onChange={() => toggle(i)} />
                      </td>
                      <td className="px-3 py-2 font-data text-xs font-medium text-gbx-charcoal whitespace-nowrap">{applyMarket(r.ticker)}</td>
                      <td className="px-3 py-2 text-xs font-body text-gbx-charcoal max-w-[240px] truncate">{r.name}</td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{r.units.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{r.price ? formatCurrency(r.price) : "—"}</td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{formatCurrency(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
