"use client";

import { useEffect, useMemo, useState } from "react";
import DocumentsPanel from "@/components/DocumentsPanel";

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
  const [file, setFile] = useState<File | null>(null);
  const [keepCopy, setKeepCopy] = useState(true);
  const [docReload, setDocReload] = useState(0);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [categoryOverrides, setCategoryOverrides] = useState<Record<number, string>>({});
  const [usMarket, setUsMarket] = useState(false);

  const [error, setError] = useState("");
  const [canOverride, setCanOverride] = useState(false);
  const [claudeReading, setClaudeReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
    fetch("/api/categories").then((r) => r.json()).then(setCategories).catch(() => {});
  }, []);

  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  function resetPreview() {
    setResult(null);
    setFile(null);
    setExcluded(new Set());
    setCategoryOverrides({});
    setUsMarket(false);
    setError("");
    setCanOverride(false);
    setMessage(null);
  }

  // Analyse the file. With no `kind`, the server auto-detects the document type;
  // with a `kind` (manual override), it parses as that type. The file is kept
  // on state throughout so the override buttons can re-submit it.
  async function analyzeFile(f: File, kind?: "holdings" | "trades" | "transactions") {
    setResult(null);
    setExcluded(new Set());
    setCategoryOverrides({});
    setError("");
    setCanOverride(false);
    setMessage(null);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (kind) fd.append("kind", kind);
      const res = await fetch("/api/import/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not analyse the file.");
        setCanOverride(Boolean(data.canOverride));
        return;
      }
      setResult(data);
    } catch {
      setError("Could not read that file.");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleFile(f: File) {
    setFile(f);
    setUsMarket(false);
    analyzeFile(f);
  }

  // When auto-detection fails, let Claude read the raw file and extract the
  // rows into the normal preview. Claude only extracts — the user still reviews
  // and clicks Import, which runs the usual deterministic save path.
  async function letClaudeRead() {
    if (!file) return;
    const priorError = error; // why auto-detect failed — include in the report
    setResult(null);
    setExcluded(new Set());
    setCategoryOverrides({});
    setError("");
    setCanOverride(false);
    setMessage(null);
    setClaudeReading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (priorError) fd.append("detectError", priorError);
      const res = await fetch("/api/agent/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Claude couldn't read that file.");
        return;
      }
      setResult(data);
    } catch {
      setError("Couldn't reach Claude — check your connection.");
    } finally {
      setClaudeReading(false);
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

  // After a successful import, optionally keep the original file in Stored
  // Documents, tagged to the account it was imported into. Non-fatal.
  async function archiveImportedFile() {
    if (!keepCopy || !file) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (accountId) fd.append("account_id", accountId);
      fd.append("notes", `Imported: ${result?.label || file.name}`);
      await fetch("/api/documents", { method: "POST", body: fd });
      setDocReload((n) => n + 1); // refresh the Stored Documents section below
    } catch {
      // The data imported fine even if archiving the copy failed.
    }
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
      const data = await res.json().catch(() => ({ error: "Server returned an unreadable response." }));
      if (data.error) {
        setMessage(`Import failed: ${data.error}`);
        return;
      }

      let msg: string;
      let ok = true; // did anything actually get added/changed?
      if (result.kind === "transactions") {
        msg = `Imported ${data.imported} transactions (${data.skipped} skipped).`;
      } else if (result.kind === "trades") {
        const changed = (data.imported || 0) + (data.reconciled || 0);
        ok = changed > 0;
        msg = ok
          ? `Imported ${data.imported} trades (${data.skipped} skipped). Holdings updated.${
              data.reconciled
                ? ` Reconciled ${data.reconciled} position${data.reconciled !== 1 ? "s" : ""} to the statement (DRP top-up).`
                : ""
            }`
          : `Import failed: nothing was added to this account — all ${data.skipped || 0} row(s) were skipped (already imported, or missing a buy/sell side, units or price). Nothing changed.`;
      } else {
        const changed = (data.imported || 0) + (data.updated || 0) + (data.reconciled || 0);
        ok = changed > 0;
        msg = ok
          ? `Imported ${data.imported} new holdings, updated ${data.updated}.${
              data.reconciled
                ? ` Reconciled ${data.reconciled} traded position${data.reconciled !== 1 ? "s" : ""} to the statement units, keeping the trade cost basis.`
                : data.imported
                  ? " Cost basis seeded from the statement — edit a holding to set the real entry price."
                  : ""
            }`
          : `Import failed: nothing was added — ${data.skipped || 0} row(s) skipped. Check you picked the right account in "Into account", and that each row has units above zero.`;
      }

      // Only archive the file and clear the preview on a real change; a no-op
      // keeps the preview so you can fix the account/rows and retry. Set the
      // message AFTER reset so it stays on screen (reset clears it otherwise).
      if (ok) {
        await archiveImportedFile();
        resetPreview();
      }
      setMessage(msg);
    } catch {
      setMessage("Import failed: couldn't reach the server. Please try again.");
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
        {error && file && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={letClaudeRead}
              disabled={claudeReading || analyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gbx-teal text-white text-[11px] uppercase tracking-[0.1em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
            >
              {claudeReading ? "Claude is reading…" : "Let Claude read this file"}
            </button>
            <span className="text-[11px] text-gbx-muted font-body">
              Claude extracts the rows into the preview below — you confirm before anything is saved.
            </span>
          </div>
        )}
        {canOverride && file && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">
              Import as:
            </span>
            {([
              ["holdings", "Holdings"],
              ["trades", "Orders"],
              ["transactions", "Transactions"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => analyzeFile(file, k)}
                disabled={analyzing}
                className="px-3 py-1.5 border border-gbx-teal text-gbx-teal text-[11px] uppercase tracking-[0.1em] font-body font-medium hover:bg-gbx-teal hover:text-white transition-colors disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {message && (
          <p
            className={`text-sm font-body font-medium ${
              message.startsWith("Import failed") ? "text-red-600" : "text-gbx-teal"
            }`}
          >
            {message}
          </p>
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
              <label
                className="flex items-center gap-1.5 text-[11px] font-body text-gbx-muted"
                title="Also save the original file to Stored Documents, tagged to this account"
              >
                <input
                  type="checkbox"
                  checked={keepCopy}
                  onChange={(e) => setKeepCopy(e.target.checked)}
                />
                Keep a copy in Documents
              </label>
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

      {/* Stored documents — keep the original files for your records */}
      <div className="border-t border-gbx-border pt-8">
        <DocumentsPanel reloadSignal={docReload} />
      </div>
    </div>
  );
}
