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

type Mode = "transactions" | "trades" | "holdings";

interface TxnRow {
  include: boolean;
  date: string;
  description: string;
  amount: number;
  category: string;
}

interface TradeRow {
  include: boolean;
  trade_date: string;
  ticker: string;
  side: string;
  units: number;
  price: number;
  fees: number;
}

interface HoldingRow {
  include: boolean;
  ticker: string;
  name: string;
  units: number;
  price: number;
  value: number;
}

// Minimal CSV parser: quoted fields, escaped quotes, CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// dd/mm/yyyy (optional time) or ISO → yyyy-mm-dd
function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/AUD/gi, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/WOOLWORTHS|COLES|ALDI|IGA |FOODWORKS|GROCER/i, "Groceries"],
  [/UBER *EATS|MENULOG|DOORDASH|DELIVEROO/i, "Dining"],
  [/MCDONALD|KFC|HUNGRY JACK|SUBWAY|CAFE|COFFEE|RESTAURANT|BAKERY|SUSHI|PIZZA|THAI|KEBAB/i, "Dining"],
  [/SHELL|BP |CALTEX|AMPOL|7-ELEVEN|UNITED PETROL|FUEL|OPAL|MYKI|TRANSLINK|UBER|TAXI|13CABS|LINKT|TOLL/i, "Transport"],
  [/NETFLIX|SPOTIFY|DISNEY|BINGE|STAN\b|KAYO|YOUTUBE|APPLE\.COM|PRIME|SUBSCRIPTION|PATREON/i, "Subscriptions"],
  [/TELSTRA|OPTUS|VODAFONE|AGL|ORIGIN|ENERGY *AUST|RED ENERGY|ALINTA|WATER|COUNCIL RATES/i, "Utilities"],
  [/NRMA|AAMI|ALLIANZ|BUDGET DIRECT|YOUI|QBE|INSURANCE|MEDIBANK|BUPA|HCF|NIB/i, "Insurance"],
  [/CHEMIST|PHARMACY|PRICELINE|TERRY WHITE|MEDICAL|DENTAL|DOCTOR|PHYSIO|HOSPITAL|MEDICARE/i, "Health"],
  [/JETSTAR|QANTAS|VIRGIN|AIRBNB|BOOKING\.COM|HOTEL|EXPEDIA|FLIGHT/i, "Travel"],
  [/KMART|BIG W|TARGET|MYER|DAVID JONES|AMAZON|EBAY|JB HI|OFFICEWORKS|BUNNINGS|IKEA/i, "Shopping"],
  [/CINEMA|EVENT|TICKETEK|TICKETMASTER|STEAM|PLAYSTATION|XBOX|NINTENDO/i, "Entertainment"],
  [/SALARY|PAYROLL|WAGES|PAY\b.*LTD|DIRECT CREDIT.*PAY/i, "Salary"],
  [/DIVIDEND|DISTRIBUTION/i, "Dividends"],
  [/RENT\b|REAL ESTATE|RAY WHITE|LJ HOOKER|MORTGAGE|HOME LOAN/i, "Housing"],
  [/SCHOOL|UNIVERSITY|TAFE|COURSE|TUITION/i, "Education"],
];

function guessCategory(description: string, amount: number): string {
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(description)) return cat;
  }
  return amount >= 0 ? "" : "Other";
}

// Some coins have no AUD pair on Yahoo Finance; map to their quoted symbol
// so imported trades line up with live pricing.
const TICKER_ALIASES: Record<string, string> = {
  "PEPE-AUD": "PEPE24478-USD",
  "BONK-AUD": "BONK-USD",
  "FARTCOIN-AUD": "FARTCOIN-USD",
};

function normaliseImportTicker(raw: string): string {
  const t = raw.trim().toUpperCase().replace("/", "-");
  return TICKER_ALIASES[t] || t;
}

function guessColumn(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
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
  const [mode, setMode] = useState<Mode>("transactions");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState("");
  const [fileName, setFileName] = useState("");
  const [txnRows, setTxnRows] = useState<TxnRow[]>([]);
  const [tradeRows, setTradeRows] = useState<TradeRow[]>([]);
  const [holdingRows, setHoldingRows] = useState<HoldingRow[]>([]);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [suffix, setSuffix] = useState(".AX");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
    fetch("/api/categories").then((r) => r.json()).then(setCategories).catch(() => {});
  }, []);

  const categoryNames = useMemo(
    () => categories.map((c) => c.name),
    [categories]
  );

  function reset() {
    setTxnRows([]);
    setTradeRows([]);
    setHoldingRows([]);
    setCashBalance(null);
    setParseError("");
    setResult(null);
    setFileName("");
  }

  function handleFile(file: File) {
    reset();
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result || ""));
        if (rows.length === 0) {
          setParseError("No rows found in that file.");
          return;
        }
        if (mode === "transactions") parseTransactions(rows);
        else if (mode === "trades") parseTrades(rows);
        else parseHoldings(rows);
      } catch {
        setParseError("Could not parse that file as CSV.");
      }
    };
    reader.readAsText(file);
  }

  function parseTransactions(rows: string[][]) {
    let dateCol = -1;
    let amountCol = -1;
    let descCol = -1;
    let debitCol = -1;
    let creditCol = -1;
    let dataRows = rows;

    const first = rows[0];
    const headerish = first.some((c) => /[a-z]/i.test(c)) && !parseDate(first[0]);
    if (headerish) {
      dateCol = guessColumn(first, ["date"]);
      amountCol = guessColumn(first, ["amount"]);
      descCol = guessColumn(first, ["description", "narrative", "details", "memo"]);
      debitCol = guessColumn(first, ["debit"]);
      creditCol = guessColumn(first, ["credit"]);
      dataRows = rows.slice(1);
    } else if (first.length >= 3 && parseDate(first[0])) {
      // CommBank export: Date, Amount, Description, Balance — no header row.
      dateCol = 0;
      amountCol = 1;
      descCol = 2;
    }

    if (dateCol === -1 || descCol === -1 || (amountCol === -1 && debitCol === -1)) {
      setParseError(
        "Couldn't recognise the columns. Expected a bank export with Date, Amount (or Debit/Credit) and Description."
      );
      return;
    }

    const parsed: TxnRow[] = [];
    for (const row of dataRows) {
      const date = parseDate(row[dateCol] || "");
      if (!date) continue;
      let amount: number | null = null;
      if (amountCol !== -1) amount = parseNumber(row[amountCol] || "");
      if (amount === null && debitCol !== -1) {
        const debit = parseNumber(row[debitCol] || "");
        const credit = creditCol !== -1 ? parseNumber(row[creditCol] || "") : null;
        if (debit !== null) amount = -Math.abs(debit);
        else if (credit !== null) amount = Math.abs(credit);
      }
      const description = (row[descCol] || "").trim();
      if (amount === null || !description) continue;
      parsed.push({
        include: true,
        date,
        description,
        amount,
        category: guessCategory(description, amount),
      });
    }

    if (parsed.length === 0) {
      setParseError("No usable transaction rows found.");
      return;
    }
    setTxnRows(parsed);
  }

  function parseTrades(rows: string[][]) {
    const first = rows[0];
    const lower = first.map((h) => h.toLowerCase());
    let parsed: TradeRow[] = [];

    if (lower.some((h) => h.includes("rate inc"))) {
      // Crypto exchange order history: Transaction Date, Type, Market, Amount, Rate inc. fee, ...
      const dateCol = guessColumn(first, ["transaction date", "date"]);
      const typeCol = guessColumn(first, ["type"]);
      const marketCol = guessColumn(first, ["market"]);
      const unitsCol = guessColumn(first, ["amount"]);
      const rateCol = guessColumn(first, ["rate inc"]);
      for (const row of rows.slice(1)) {
        const date = parseDate(row[dateCol] || "");
        const units = parseNumber(row[unitsCol] || "");
        const price = parseNumber(row[rateCol] || "");
        const side = (row[typeCol] || "").toLowerCase().trim();
        const ticker = normaliseImportTicker(row[marketCol] || "");
        if (!date || !units || price === null || !ticker) continue;
        if (side !== "buy" && side !== "sell") continue;
        parsed.push({ include: true, trade_date: date, ticker, side, units, price, fees: 0 });
      }
    } else {
      // Generic: date, ticker/symbol/code, side/type, units/quantity, price, fees
      const dateCol = guessColumn(first, ["date"]);
      const tickerCol = guessColumn(first, ["ticker", "symbol", "code", "market", "security"]);
      const sideCol = guessColumn(first, ["side", "type", "action"]);
      const unitsCol = guessColumn(first, ["units", "quantity", "qty", "volume", "amount"]);
      const priceCol = guessColumn(first, ["price", "rate"]);
      const feesCol = guessColumn(first, ["fee", "brokerage", "commission"]);
      if (dateCol === -1 || tickerCol === -1 || sideCol === -1 || unitsCol === -1 || priceCol === -1) {
        setParseError(
          "Couldn't recognise the columns. Expected Date, Ticker, Side (buy/sell), Units and Price headers."
        );
        return;
      }
      for (const row of rows.slice(1)) {
        const date = parseDate(row[dateCol] || "");
        const units = parseNumber(row[unitsCol] || "");
        const price = parseNumber(row[priceCol] || "");
        const fees = feesCol !== -1 ? parseNumber(row[feesCol] || "") || 0 : 0;
        const side = (row[sideCol] || "").toLowerCase().trim();
        const ticker = normaliseImportTicker(row[tickerCol] || "");
        if (!date || !units || price === null || !ticker) continue;
        if (side !== "buy" && side !== "sell") continue;
        parsed.push({ include: true, trade_date: date, ticker, side, units, price, fees });
      }
    }

    if (parsed.length === 0) {
      setParseError("No usable trade rows found.");
      return;
    }
    setTradeRows(parsed);
  }

  function parseHoldings(rows: string[][]) {
    const first = rows[0];
    const headerish =
      first.some((c) => /[a-z]/i.test(c)) &&
      parseNumber(first[0]) === null &&
      !/^(cash|[A-Z0-9]{2,6})$/.test(first[0].trim());

    let tickerCol = 0;
    let nameCol = 1;
    let priceCol = 2;
    let unitsCol = 3;
    let valueCol = 4;
    let dataRows = rows;

    if (headerish) {
      tickerCol = guessColumn(first, ["ticker", "symbol", "code", "security"]);
      nameCol = guessColumn(first, ["name", "description"]);
      priceCol = guessColumn(first, ["price", "last", "market price"]);
      unitsCol = guessColumn(first, ["units", "quantity", "qty", "shares", "holding"]);
      valueCol = guessColumn(first, ["value", "market value", "balance"]);
      dataRows = rows.slice(1);
      if (tickerCol === -1 || unitsCol === -1) {
        setParseError(
          "Couldn't recognise the columns. Expected Ticker, Units and (optionally) Price and Value."
        );
        return;
      }
    }

    const parsed: HoldingRow[] = [];
    let cash: number | null = null;
    for (const row of dataRows) {
      const rawTicker = (row[tickerCol] || "").trim();
      if (!rawTicker) continue;
      const value = valueCol !== -1 ? parseNumber(row[valueCol] || "") : null;

      // A CASH line is the account's cash balance, not a holding.
      if (/^cash$/i.test(rawTicker)) {
        if (value !== null) cash = value;
        continue;
      }

      const units = parseNumber(row[unitsCol] || "");
      const price = priceCol !== -1 ? parseNumber(row[priceCol] || "") : null;
      if (!units || units <= 0) continue;

      parsed.push({
        include: true,
        ticker: rawTicker.toUpperCase(),
        name: (row[nameCol] || "").trim(),
        units,
        // Cost basis is unknown from a valuation file; seed with the shown
        // price so gain/loss starts near zero rather than a false +100%.
        price: price ?? 0,
        value: value ?? (price ? price * units : 0),
      });
    }

    if (parsed.length === 0) {
      setParseError("No usable holdings found in that file.");
      return;
    }
    setHoldingRows(parsed);
    setCashBalance(cash);
  }

  function applySuffix(ticker: string): string {
    if (suffix === "" || ticker.includes(".") || ticker.includes("-")) {
      return ticker;
    }
    return ticker + suffix;
  }

  async function handleImport() {
    if (!accountId) return;
    setImporting(true);
    setResult(null);
    try {
      if (mode === "transactions") {
        const rows = txnRows.filter((r) => r.include);
        const res = await fetch("/api/transactions/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            transactions: rows.map((r) => ({
              date: r.date,
              amount: r.amount,
              description: r.description,
              category: r.category || null,
            })),
          }),
        });
        const data = await res.json();
        setResult(
          data.error
            ? `Import failed: ${data.error}`
            : `Imported ${data.imported} transactions (${data.skipped} skipped as duplicates or invalid).`
        );
        if (!data.error) setTxnRows([]);
      } else if (mode === "trades") {
        const rows = tradeRows.filter((r) => r.include);
        const res = await fetch("/api/trades/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            trades: rows.map(({ include: _i, ...t }) => t),
          }),
        });
        const data = await res.json();
        setResult(
          data.error
            ? `Import failed: ${data.error}`
            : `Imported ${data.imported} trades (${data.skipped} skipped as duplicates or invalid). Holdings updated.`
        );
        if (!data.error) setTradeRows([]);
      } else {
        const rows = holdingRows.filter((r) => r.include);
        const res = await fetch("/api/holdings/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            holdings: rows.map((r) => ({
              ticker: applySuffix(r.ticker),
              name: r.name || null,
              units: r.units,
              cost_basis: r.price,
            })),
            cash: cashBalance,
          }),
        });
        const data = await res.json();
        setResult(
          data.error
            ? `Import failed: ${data.error}`
            : `Imported ${data.imported} new holdings, updated ${data.updated}${
                cashBalance !== null
                  ? `, cash balance set to ${formatCurrency(cashBalance)}`
                  : ""
              }. Cost basis was seeded from the statement price — edit any holding to enter the real entry price.`
        );
        if (!data.error) {
          setHoldingRows([]);
          setCashBalance(null);
        }
      }
    } finally {
      setImporting(false);
    }
  }

  const previewCount =
    mode === "transactions"
      ? txnRows.filter((r) => r.include).length
      : mode === "trades"
        ? tradeRows.filter((r) => r.include).length
        : holdingRows.filter((r) => r.include).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal">Import</h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          Load bank statements and trade history from CSV exports
        </p>
      </div>

      <div className="bg-white border border-gbx-border p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>What are you importing?</label>
            <select
              className={inputClass}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as Mode);
                reset();
              }}
            >
              <option value="transactions">Bank transactions</option>
              <option value="trades">Trade history (buys / sells)</option>
              <option value="holdings">Holdings valuation</option>
            </select>
          </div>

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
            <label className={labelClass}>CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="w-full text-sm font-body text-gbx-charcoal file:mr-3 file:px-4 file:py-2 file:border file:border-gbx-teal file:bg-white file:text-gbx-teal file:text-[11px] file:uppercase file:tracking-[0.1em] file:font-medium file:cursor-pointer"
            />
          </div>
        </div>

        {mode === "holdings" && (
          <div className="sm:w-1/3">
            <label className={labelClass}>Ticker market</label>
            <select
              className={inputClass}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            >
              <option value=".AX">ASX — append .AX</option>
              <option value="">US / already suffixed — leave as-is</option>
            </select>
          </div>
        )}

        <p className="text-[11px] text-gbx-muted font-body">
          {mode === "transactions"
            ? "Works with CommBank exports (no header) and any CSV with Date, Amount (or Debit/Credit) and Description columns. Categories are guessed automatically — adjust them in the preview."
            : mode === "trades"
              ? "Works with exchange order-history exports (Rate inc. fee format) and any CSV with Date, Ticker, Side, Units and Price columns. Buys and sells update your holdings automatically."
              : "Works with brokerage holdings valuations — a positions list of ticker, name, price, units and value (with or without headers). A CASH row is recorded as the account's cash balance. Existing holdings for the same ticker are updated."}
        </p>

        {parseError && (
          <p className="text-sm text-red-600 font-body">{parseError}</p>
        )}
        {result && (
          <p className="text-sm text-gbx-teal font-body font-medium">{result}</p>
        )}
      </div>

      {mode === "transactions" && txnRows.length > 0 && (
        <div className="bg-white border border-gbx-border">
          <div className="px-4 sm:px-6 pt-5 pb-3 flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
              Preview — {fileName}
            </h2>
            <button
              onClick={handleImport}
              disabled={importing || !accountId || previewCount === 0}
              className="px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
            >
              {importing
                ? "Importing..."
                : `Import ${previewCount} transaction${previewCount !== 1 ? "s" : ""}`}
            </button>
          </div>
          {!accountId && (
            <p className="px-4 sm:px-6 pb-2 text-[11px] text-red-600 font-body">
              Select an account above first.
            </p>
          )}
          <div className="overflow-x-auto">
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
                {txnRows.map((r, i) => (
                  <tr key={i} className={`border-b border-gbx-border/50 ${r.include ? "" : "opacity-40"}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) =>
                          setTxnRows((rows) =>
                            rows.map((row, j) =>
                              j === i ? { ...row, include: e.target.checked } : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2 text-xs font-body text-gbx-charcoal max-w-[240px] truncate">{r.description}</td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <select
                        value={r.category}
                        onChange={(e) =>
                          setTxnRows((rows) =>
                            rows.map((row, j) =>
                              j === i ? { ...row, category: e.target.value } : row
                            )
                          )
                        }
                        className="border border-gbx-border text-xs font-body px-2 py-1 bg-white text-gbx-charcoal"
                      >
                        <option value="">—</option>
                        {categoryNames.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className={`px-3 py-2 text-right font-data text-xs whitespace-nowrap ${r.amount >= 0 ? "text-gbx-teal" : "text-red-600"}`}>
                      {r.amount >= 0 ? "+" : ""}
                      {formatCurrency(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === "trades" && tradeRows.length > 0 && (
        <div className="bg-white border border-gbx-border">
          <div className="px-4 sm:px-6 pt-5 pb-3 flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
              Preview — {fileName}
            </h2>
            <button
              onClick={handleImport}
              disabled={importing || !accountId || previewCount === 0}
              className="px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
            >
              {importing
                ? "Importing..."
                : `Import ${previewCount} trade${previewCount !== 1 ? "s" : ""}`}
            </button>
          </div>
          {!accountId && (
            <p className="px-4 sm:px-6 pb-2 text-[11px] text-red-600 font-body">
              Select an account above first.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-gbx-border">
                  <th className="px-3 py-2 w-8" />
                  {["Date", "Ticker", "Side", "Units", "Price", "Total"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeRows.map((r, i) => (
                  <tr key={i} className={`border-b border-gbx-border/50 ${r.include ? "" : "opacity-40"}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) =>
                          setTradeRows((rows) =>
                            rows.map((row, j) =>
                              j === i ? { ...row, include: e.target.checked } : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal whitespace-nowrap">{r.trade_date}</td>
                    <td className="px-3 py-2 font-data text-xs font-medium text-gbx-charcoal">{r.ticker}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] uppercase tracking-[0.12em] font-body font-medium px-1.5 py-0.5 ${r.side === "buy" ? "bg-gbx-teal/10 text-gbx-teal" : "bg-red-600/10 text-red-600"}`}>
                        {r.side}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{r.units.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{formatCurrency(r.price)}</td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{formatCurrency(r.units * r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === "holdings" && holdingRows.length > 0 && (
        <div className="bg-white border border-gbx-border">
          <div className="px-4 sm:px-6 pt-5 pb-3 flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
                Preview — {fileName}
              </h2>
              {cashBalance !== null && (
                <p className="text-[11px] text-gbx-muted font-body mt-1">
                  Cash balance {formatCurrency(cashBalance)} will be recorded on
                  the account
                </p>
              )}
            </div>
            <button
              onClick={handleImport}
              disabled={importing || !accountId || previewCount === 0}
              className="px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
            >
              {importing
                ? "Importing..."
                : `Import ${previewCount} holding${previewCount !== 1 ? "s" : ""}`}
            </button>
          </div>
          {!accountId && (
            <p className="px-4 sm:px-6 pb-2 text-[11px] text-red-600 font-body">
              Select an account above first.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-gbx-border">
                  <th className="px-3 py-2 w-8" />
                  {["Ticker", "Name", "Units", "Price", "Value"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] font-body font-medium text-gbx-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdingRows.map((r, i) => (
                  <tr key={i} className={`border-b border-gbx-border/50 ${r.include ? "" : "opacity-40"}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) =>
                          setHoldingRows((rows) =>
                            rows.map((row, j) =>
                              j === i ? { ...row, include: e.target.checked } : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-data text-xs font-medium text-gbx-charcoal whitespace-nowrap">
                      {applySuffix(r.ticker)}
                    </td>
                    <td className="px-3 py-2 text-xs font-body text-gbx-charcoal max-w-[240px] truncate">{r.name}</td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{r.units.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{r.price ? formatCurrency(r.price) : "—"}</td>
                    <td className="px-3 py-2 font-data text-xs text-gbx-charcoal">{formatCurrency(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
