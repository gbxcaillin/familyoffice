// Self-identifying import: given raw CSV text or extracted PDF text, work out
// what kind of financial document it is and parse it into a normalized shape.

export type ImportKind = "transactions" | "trades" | "holdings";

export interface TxnRow {
  date: string;
  description: string;
  amount: number;
  category: string | null;
}
export interface TradeRow {
  trade_date: string;
  ticker: string;
  side: "buy" | "sell";
  units: number;
  price: number;
  fees: number;
}
export interface HoldingRow {
  ticker: string;
  name: string;
  units: number;
  price: number;
  value: number;
}

export interface AnalyzeResult {
  kind: ImportKind;
  source: string;
  label: string;
  transactions?: TxnRow[];
  trades?: TradeRow[];
  holdings?: HoldingRow[];
  cash?: number | null;
  warnings: string[];
}

// ---- shared helpers ----

export function parseCsv(text: string): string[][] {
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
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function num(raw: string): number | null {
  const c = raw.replace(/[$,\s]/g, "").replace(/AUD/gi, "");
  if (c === "" || c === "-") return null;
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

function guessCol(headers: string[], cands: string[]): number {
  const low = headers.map((h) => h.toLowerCase().trim());
  for (const c of cands) {
    const i = low.findIndex((h) => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/WOOLWORTHS|COLES|ALDI|IGA |FOODWORKS|GROCER/i, "Groceries"],
  [/UBER *EATS|MENULOG|DOORDASH|DELIVEROO|MCDONALD|KFC|HUNGRY JACK|CAFE|COFFEE|RESTAURANT|BAKERY|SUSHI|PIZZA/i, "Dining"],
  [/SHELL|BP |CALTEX|AMPOL|7-ELEVEN|FUEL|OPAL|MYKI|LINKT|TOLL|UBER|TAXI/i, "Transport"],
  [/NETFLIX|SPOTIFY|DISNEY|BINGE|STAN\b|KAYO|YOUTUBE|APPLE\.COM|PRIME|SUBSCRIPTION/i, "Subscriptions"],
  [/TELSTRA|OPTUS|VODAFONE|AGL|ORIGIN|ENERGY|RED ENERGY|WATER|COUNCIL RATES/i, "Utilities"],
  [/NRMA|AAMI|ALLIANZ|BUDGET DIRECT|YOUI|QBE|INSURANCE|MEDIBANK|BUPA|HCF|NIB/i, "Insurance"],
  [/CHEMIST|PHARMACY|PRICELINE|MEDICAL|DENTAL|DOCTOR|PHYSIO|HOSPITAL|MEDICARE/i, "Health"],
  [/JETSTAR|QANTAS|VIRGIN|AIRBNB|BOOKING\.COM|HOTEL|FLIGHT/i, "Travel"],
  [/KMART|BIG W|TARGET|MYER|AMAZON|EBAY|JB HI|OFFICEWORKS|BUNNINGS|IKEA/i, "Shopping"],
  [/SALARY|PAYROLL|WAGES/i, "Salary"],
  [/DIVIDEND|DISTRIBUTION/i, "Dividends"],
  [/RENT\b|MORTGAGE|HOME LOAN/i, "Housing"],
];
function guessCategory(desc: string, amount: number): string | null {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(desc)) return cat;
  return amount >= 0 ? null : "Other";
}

const TICKER_ALIASES: Record<string, string> = {
  "PEPE-AUD": "PEPE24478-USD",
  "BONK-AUD": "BONK-USD",
  "FARTCOIN-AUD": "FARTCOIN-USD",
};
function asxTicker(code: string): string {
  const t = code.toUpperCase().trim();
  if (TICKER_ALIASES[t]) return TICKER_ALIASES[t];
  if (t.includes(".") || t.includes("-")) return t;
  return t + ".AX";
}

// ---- CSV detectors ----

function detectSelfwealthCashReport(rows: string[][]): AnalyzeResult | null {
  const header = rows[0].join(",").toLowerCase();
  if (
    !header.includes("transactiondate") ||
    !header.includes("comment") ||
    !header.includes("credit") ||
    !header.includes("debit")
  )
    return null;

  const trades: TradeRow[] = [];
  const seenOrders = new Set<string>();
  const orderRe = /Order (\d+):\s*(Buy|Sell)\s+([\d,]+)\s+([A-Z0-9]+)\s+@\s+A?\$?([\d.]+)/i;

  for (const row of rows.slice(1)) {
    const date = parseDate(row[0] || "");
    const comment = row[1] || "";
    const m = comment.match(orderRe);
    if (!date || !m) continue;
    const orderNo = m[1];
    const fee = seenOrders.has(orderNo) ? 0 : 9.5;
    seenOrders.add(orderNo);
    trades.push({
      trade_date: date,
      ticker: asxTicker(m[4]),
      side: m[2].toLowerCase() as "buy" | "sell",
      units: parseFloat(m[3].replace(/,/g, "")),
      price: parseFloat(m[5]),
      fees: fee,
    });
  }
  if (trades.length === 0) return null;
  return {
    kind: "trades",
    source: "selfwealth-cashreport",
    label: "SelfWealth cash report — trade history",
    trades,
    warnings: [],
  };
}

function detectExchangeOrders(rows: string[][]): AnalyzeResult | null {
  const header = rows[0].map((h) => h.toLowerCase());
  if (!header.some((h) => h.includes("rate inc"))) return null;
  const dateCol = guessCol(rows[0], ["transaction date", "date"]);
  const typeCol = guessCol(rows[0], ["type"]);
  const marketCol = guessCol(rows[0], ["market"]);
  const unitsCol = guessCol(rows[0], ["amount"]);
  const rateCol = guessCol(rows[0], ["rate inc"]);
  const trades: TradeRow[] = [];
  for (const row of rows.slice(1)) {
    const date = parseDate(row[dateCol] || "");
    const units = num(row[unitsCol] || "");
    const price = num(row[rateCol] || "");
    const side = (row[typeCol] || "").toLowerCase().trim();
    const ticker = asxTicker((row[marketCol] || "").replace("/", "-"));
    if (!date || !units || price === null || (side !== "buy" && side !== "sell")) continue;
    trades.push({ trade_date: date, ticker, side, units, price, fees: 0 });
  }
  if (trades.length === 0) return null;
  return {
    kind: "trades",
    source: "exchange-orders",
    label: "Crypto exchange — order history",
    trades,
    warnings: [],
  };
}

function detectGenericTrades(rows: string[][]): AnalyzeResult | null {
  const h = rows[0];
  const dateCol = guessCol(h, ["date"]);
  const tickerCol = guessCol(h, ["ticker", "symbol", "code", "security"]);
  const sideCol = guessCol(h, ["side", "type", "action"]);
  const unitsCol = guessCol(h, ["units", "quantity", "qty", "volume"]);
  const priceCol = guessCol(h, ["price", "rate"]);
  const feesCol = guessCol(h, ["fee", "brokerage", "commission"]);
  if (dateCol === -1 || tickerCol === -1 || sideCol === -1 || unitsCol === -1 || priceCol === -1)
    return null;
  const trades: TradeRow[] = [];
  for (const row of rows.slice(1)) {
    const date = parseDate(row[dateCol] || "");
    const units = num(row[unitsCol] || "");
    const price = num(row[priceCol] || "");
    const side = (row[sideCol] || "").toLowerCase().trim();
    const ticker = asxTicker((row[tickerCol] || "").replace("/", "-"));
    if (!date || !units || price === null || (side !== "buy" && side !== "sell")) continue;
    trades.push({
      trade_date: date,
      ticker,
      side,
      units,
      price,
      fees: feesCol !== -1 ? num(row[feesCol] || "") || 0 : 0,
    });
  }
  if (trades.length === 0) return null;
  return { kind: "trades", source: "generic-trades", label: "Trade history", trades, warnings: [] };
}

function detectBankTransactions(rows: string[][]): AnalyzeResult | null {
  const first = rows[0];
  let dateCol = -1, amountCol = -1, descCol = -1, debitCol = -1, creditCol = -1;
  let dataRows = rows;
  const headerish = first.some((c) => /[a-z]/i.test(c)) && !parseDate(first[0]);
  if (headerish) {
    dateCol = guessCol(first, ["date"]);
    amountCol = guessCol(first, ["amount"]);
    descCol = guessCol(first, ["description", "narrative", "details", "memo"]);
    debitCol = guessCol(first, ["debit"]);
    creditCol = guessCol(first, ["credit"]);
    dataRows = rows.slice(1);
  } else if (first.length >= 3 && parseDate(first[0])) {
    dateCol = 0; amountCol = 1; descCol = 2;
  }
  if (dateCol === -1 || descCol === -1 || (amountCol === -1 && debitCol === -1)) return null;

  const txns: TxnRow[] = [];
  for (const row of dataRows) {
    const date = parseDate(row[dateCol] || "");
    if (!date) continue;
    let amount: number | null = amountCol !== -1 ? num(row[amountCol] || "") : null;
    if (amount === null && debitCol !== -1) {
      const d = num(row[debitCol] || "");
      const c = creditCol !== -1 ? num(row[creditCol] || "") : null;
      if (d !== null) amount = -Math.abs(d);
      else if (c !== null) amount = Math.abs(c);
    }
    const description = (row[descCol] || "").trim();
    if (amount === null || !description) continue;
    txns.push({ date, description, amount, category: guessCategory(description, amount) });
  }
  if (txns.length === 0) return null;
  return {
    kind: "transactions",
    source: "bank-csv",
    label: "Bank transactions",
    transactions: txns,
    warnings: [],
  };
}

function detectHoldingsCsv(rows: string[][]): AnalyzeResult | null {
  const first = rows[0];
  const headerish =
    first.some((c) => /[a-z]/i.test(c)) &&
    num(first[0]) === null &&
    !/^(cash|[A-Z0-9]{2,6})$/.test(first[0].trim());
  let tickerCol = 0, nameCol = 1, priceCol = 2, unitsCol = 3, valueCol = 4;
  let dataRows = rows;
  if (headerish) {
    tickerCol = guessCol(first, ["ticker", "symbol", "code", "security"]);
    nameCol = guessCol(first, ["name", "description"]);
    priceCol = guessCol(first, ["price", "last"]);
    unitsCol = guessCol(first, ["units", "quantity", "qty", "shares", "holding"]);
    valueCol = guessCol(first, ["value", "market value", "balance"]);
    dataRows = rows.slice(1);
    if (tickerCol === -1 || unitsCol === -1) return null;
  }
  const holdings: HoldingRow[] = [];
  let cash: number | null = null;
  for (const row of dataRows) {
    const rawTicker = (row[tickerCol] || "").trim();
    if (!rawTicker) continue;
    const value = valueCol !== -1 ? num(row[valueCol] || "") : null;
    if (/^cash$/i.test(rawTicker)) {
      if (value !== null) cash = value;
      continue;
    }
    const units = num(row[unitsCol] || "");
    const price = priceCol !== -1 ? num(row[priceCol] || "") : null;
    if (!units || units <= 0) continue;
    holdings.push({
      ticker: asxTicker(rawTicker),
      name: (row[nameCol] || "").trim(),
      units,
      price: price ?? 0,
      value: value ?? (price ? price * units : 0),
    });
  }
  if (holdings.length === 0) return null;
  return {
    kind: "holdings",
    source: "holdings-csv",
    label: "Holdings valuation",
    holdings,
    cash,
    warnings: [],
  };
}

// ---- PDF detectors ----

// Known issuer/name prefixes that follow the ASX code in a concatenated
// statement line — used to find where the code ends and the name begins.
const NAME_PREFIXES = [
  "VANGUARD", "VANECK", "VANETHIC", "VAN", "BETASHARES", "BETANASDAQ", "BETA",
  "GLOBALX", "GLBX", "GBLX", "GLOBAL", "LOFTUS", "ISHARES", "ISCS", "ISHARE",
  "ISH", "SPDR", "MAGELLAN", "HYPERION", "PLATINUM", "FIDELITY", "RUSSELL",
  "MONTGOMERY", "MORNINGSTAR", "NASDAQ", "GOLD", "AUSTRALIAN",
];

// Split "ESTXGLBXEUROSTOXX" into code (ESTX) + name by testing whether the
// remainder after a 3- or 4-letter code starts with a known name prefix.
function splitCodeName(concat: string): { code: string; name: string } {
  const caps = (concat.match(/^[A-Z]+/) || [""])[0];
  for (const len of [3, 4, 5]) {
    const rest = caps.slice(len);
    if (NAME_PREFIXES.some((p) => rest.startsWith(p))) {
      return { code: caps.slice(0, len), name: concat.slice(len) };
    }
  }
  // Fallback: assume a 4-letter code (the ASX ETF norm).
  return { code: caps.slice(0, 4), name: concat.slice(4) };
}

function detectSelfwealthStatement(raw: string): AnalyzeResult | null {
  // PDFs use non-breaking spaces and soft hyphens; normalise before matching.
  const text = raw.replace(/­/g, "").replace(/[ \t]/g, " ");
  if (!/selfwealth/i.test(text) || !/Holdings\s+Valuation\s+as\s+at/i.test(text))
    return null;

  const blocks = [...text.matchAll(/Holdings\s+Valuation\s+as\s+at[^\n]*/gi)];
  const lastIdx = blocks.length ? blocks[blocks.length - 1].index! : -1;
  if (lastIdx === -1) return null;
  const tail = text.slice(lastIdx);
  const end = tail.search(/\n\s*Total|Account:|Transaction\s+Summary/i);
  const block = end > 0 ? tail.slice(0, end) : tail;

  const holdings: HoldingRow[] = [];
  // Capture: <code+name+units>$<price>$<value>. Units come from value/price so
  // digits embedded in the name (STOXX50, NASDAQ100) don't corrupt them.
  const rowRe = /([A-Z]{2}[A-Za-z0-9 +.'/&-]*?)\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block)) !== null) {
    const prefix = m[1].replace(/\d[\d,]*$/, "").trim(); // strip trailing units
    const price = parseFloat(m[2].replace(/,/g, ""));
    const value = parseFloat(m[3].replace(/,/g, ""));
    if (!price || !value || !/^[A-Z]/.test(prefix)) continue;
    const units = Math.round((value / price) * 1e6) / 1e6;
    if (units <= 0) continue;
    const { code, name } = splitCodeName(prefix);
    if (code.length < 2) continue;
    holdings.push({ ticker: asxTicker(code), name: name.trim(), units, price, value });
  }
  if (holdings.length === 0) return null;
  return {
    kind: "holdings",
    source: "selfwealth-statement",
    label: "SelfWealth annual statement — holdings",
    holdings,
    warnings: [
      "Tickers were read from the statement text — glance over them before importing. For the full trade history, the SelfWealth cash report CSV is more precise.",
    ],
  };
}

function detectSuperheroStatement(text: string): AnalyzeResult | null {
  if (!/superhero/i.test(text) || !/Portfolio Valuation/i.test(text)) return null;
  // Rows like: DFNDVanEck Global Defence ETF11$45.58...$384.34-$117.06-23.35%
  const holdings: HoldingRow[] = [];
  const rowRe = /^([A-Z]{2,5})([A-Za-z][A-Za-z0-9 +.'/&-]*?)(\d[\d,]*)\$([\d.]+)\$([\d,]+\.\d{2})/gm;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const units = parseFloat(m[3].replace(/,/g, ""));
    const price = parseFloat(m[4]);
    if (!units || !price) continue;
    holdings.push({
      ticker: asxTicker(m[1]),
      name: m[2].trim(),
      units,
      price,
      value: parseFloat(m[5].replace(/,/g, "")),
    });
  }
  if (holdings.length === 0) return null;
  return {
    kind: "holdings",
    source: "superhero-statement",
    label: "Superhero portfolio valuation — holdings",
    holdings,
    warnings: ["Tickers were read from the statement text — check them in the preview."],
  };
}

// ---- entry points ----

export function analyzeCsv(text: string): AnalyzeResult | null {
  const rows = parseCsv(text);
  if (rows.length === 0) return null;
  return (
    detectSelfwealthCashReport(rows) ||
    detectExchangeOrders(rows) ||
    detectGenericTrades(rows) ||
    detectBankTransactions(rows) ||
    detectHoldingsCsv(rows)
  );
}

export function analyzePdfText(text: string): AnalyzeResult | null {
  return detectSelfwealthStatement(text) || detectSuperheroStatement(text);
}
