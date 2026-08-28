import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getQuotes, getDividendHistory } from "./market";

interface QuoteLike {
  price: number;
  currency: string;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  marketCap: number | null;
  dividendYield: number | null;
  annualDividend: number | null;
  name: string;
  exchange: string;
}

export function upsertQuote(
  db: Database.Database,
  ticker: string,
  q: QuoteLike
) {
  db.prepare(
    `INSERT INTO price_cache (ticker, price, currency, change_percent, day_high, day_low, market_cap, dividend_yield, annual_dividend, name, exchange, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ticker) DO UPDATE SET
       price = excluded.price,
       currency = excluded.currency,
       change_percent = excluded.change_percent,
       day_high = excluded.day_high,
       day_low = excluded.day_low,
       market_cap = excluded.market_cap,
       dividend_yield = excluded.dividend_yield,
       annual_dividend = excluded.annual_dividend,
       name = excluded.name,
       exchange = excluded.exchange,
       updated_at = excluded.updated_at`
  ).run(
    ticker,
    q.price,
    q.currency,
    q.changePercent,
    q.dayHigh,
    q.dayLow,
    q.marketCap,
    q.dividendYield,
    q.annualDividend,
    q.name,
    q.exchange
  );
}

export async function refreshAllPrices(db: Database.Database) {
  const tickers = (
    db
      .prepare("SELECT DISTINCT UPPER(ticker) as ticker FROM holdings")
      .all() as { ticker: string }[]
  ).map((t) => t.ticker);

  if (tickers.length === 0) return { updated: 0, failed: [] as string[] };

  const quotes = await getQuotes(tickers);
  const batch = db.transaction(() => {
    for (const [t, q] of Object.entries(quotes)) upsertQuote(db, t, q);
  });
  batch();

  return {
    updated: Object.keys(quotes).length,
    failed: tickers.filter((t) => !quotes[t]),
  };
}

export interface NetWorthTotals {
  totalNetWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  person1Total: number;
  person2Total: number;
  jointTotal: number;
  holdingsTotal: number;
  byType: Record<string, number>;
  accountCount: number;
}

export function computeNetWorth(db: Database.Database): NetWorthTotals {
  const accounts = db
    .prepare(
      `SELECT a.id, a.type, a.owner,
        (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as latest_balance
       FROM accounts a`
    )
    .all() as { id: string; type: string; owner: string; latest_balance: number | null }[];

  let totalNetWorth = 0;
  let person1Total = 0;
  let person2Total = 0;
  let jointTotal = 0;
  const byType: Record<string, number> = {};

  for (const acc of accounts) {
    const bal = acc.latest_balance || 0;
    totalNetWorth += bal;
    byType[acc.type] = (byType[acc.type] || 0) + bal;
    if (acc.owner === "person1") person1Total += bal;
    else if (acc.owner === "person2") person2Total += bal;
    else jointTotal += bal;
  }

  // Each holding's person1 share: explicit pct_p1, else inherited from the
  // account owner (person1 100%, person2 0%, joint 50%). The legacy per-holding
  // `owner` column is intentionally ignored here so this matches the breakdown
  // endpoint. We aggregate per holding in JS rather than GROUP BY the resolved
  // percentage: the alias `pct_p1` collides with the real (mostly NULL) h.pct_p1
  // column, so SQLite would group on the column instead of the CASE expression
  // and mis-attribute every holding to one arbitrary owner.
  const holdingRows = db
    .prepare(
      `SELECT a.type as account_type,
        COALESCE(
          h.pct_p1,
          CASE a.owner
            WHEN 'person1' THEN 100
            WHEN 'person2' THEN 0
            ELSE 50
          END
        ) as resolved_pct,
        h.units * pc.price as market_value
       FROM holdings h
       JOIN accounts a ON h.account_id = a.id
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       WHERE pc.price IS NOT NULL`
    )
    .all() as { account_type: string; resolved_pct: number; market_value: number | null }[];

  let holdingsTotal = 0;
  for (const row of holdingRows) {
    const val = row.market_value || 0;
    holdingsTotal += val;
    totalNetWorth += val;
    byType[row.account_type] = (byType[row.account_type] || 0) + val;
    const p1 = Math.max(0, Math.min(100, row.resolved_pct)) / 100;
    person1Total += val * p1;
    person2Total += val * (1 - p1);
  }

  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const value of Object.values(byType)) {
    if (value >= 0) totalAssets += value;
    else totalLiabilities += -value;
  }

  return {
    totalNetWorth,
    totalAssets,
    totalLiabilities,
    person1Total,
    person2Total,
    jointTotal,
    holdingsTotal,
    byType,
    accountCount: accounts.length,
  };
}

// Write today's portfolio valuation. One row per day; re-running updates it.
export function recordSnapshot(db: Database.Database): NetWorthTotals {
  const totals = computeNetWorth(db);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO snapshots (id, date, total_net_worth, total_assets, total_liabilities, holdings_value, person1_total, person2_total, joint_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_net_worth = excluded.total_net_worth,
       total_assets = excluded.total_assets,
       total_liabilities = excluded.total_liabilities,
       holdings_value = excluded.holdings_value,
       person1_total = excluded.person1_total,
       person2_total = excluded.person2_total,
       joint_total = excluded.joint_total`
  ).run(
    `snp_${randomUUID().slice(0, 8)}`,
    today,
    totals.totalNetWorth,
    totals.totalAssets,
    totals.totalLiabilities,
    totals.holdingsTotal,
    totals.person1Total,
    totals.person2Total,
    totals.jointTotal
  );
  return totals;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Reconstruct a net worth history so the trend has something to show before
// daily snapshots accumulate. Method mirrors the performance chart: current
// holdings valued at historical prices, on top of a constant base of current
// account balances. Early points therefore assume today's positions — an
// estimate, but a useful market-driven trend.
export async function backfillSnapshots(
  db: Database.Database,
  days = 365
): Promise<{ written: number }> {
  const { getYahoo } = await import("./market");

  const accountsBase = (
    db
      .prepare(
        `SELECT COALESCE(SUM(
           (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1)
         ), 0) as total FROM accounts a`
      )
      .get() as { total: number }
  ).total;

  const positions = db
    .prepare(
      `SELECT UPPER(ticker) as ticker, SUM(units) as units
       FROM holdings GROUP BY UPPER(ticker) HAVING SUM(units) > 0`
    )
    .all() as { ticker: string; units: number }[];

  const from = new Date(Date.now() - days * 86_400_000);
  const to = new Date();
  const yahooFinance = await getYahoo();

  // Historical close per ticker (weekly), plus USD→AUD for USD-quoted ones.
  const seriesByTicker: Record<string, Map<string, number>> = {};
  const currencyByTicker: Record<string, string> = {};
  const allDates = new Set<string>();

  await Promise.all(
    positions.map(async (p) => {
      try {
        const r: any = await yahooFinance.chart(p.ticker, {
          period1: from,
          period2: to,
          interval: "1wk",
        });
        const m = new Map<string, number>();
        for (const q of r?.quotes || []) {
          if (q.close == null) continue;
          const d = new Date(q.date).toISOString().slice(0, 10);
          m.set(d, q.close);
          allDates.add(d);
        }
        if (m.size > 0) {
          seriesByTicker[p.ticker] = m;
          currencyByTicker[p.ticker] = r?.meta?.currency || "AUD";
        }
      } catch {
        // Skip tickers without history.
      }
    })
  );

  let fxMap: Map<string, number> | null = null;
  if (Object.values(currencyByTicker).some((c) => c === "USD")) {
    try {
      const r: any = await yahooFinance.chart("AUD=X", {
        period1: from,
        period2: to,
        interval: "1wk",
      });
      fxMap = new Map();
      for (const q of r?.quotes || []) {
        if (q.close == null) continue;
        fxMap.set(new Date(q.date).toISOString().slice(0, 10), q.close);
      }
    } catch {
      fxMap = null;
    }
  }

  const sortedDates = [...allDates].sort();
  if (sortedDates.length === 0) return { written: 0 };

  const unitsByTicker = new Map(positions.map((p) => [p.ticker, p.units]));
  const lastPrice: Record<string, number> = {};
  const lastFx: Record<string, number> = {};
  let lastFxRate = 1;

  const upsert = db.prepare(
    `INSERT INTO snapshots (id, date, total_net_worth, total_assets, total_liabilities, holdings_value, person1_total, person2_total, joint_total)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
     ON CONFLICT(date) DO UPDATE SET
       total_net_worth = excluded.total_net_worth,
       total_assets = excluded.total_assets,
       total_liabilities = excluded.total_liabilities,
       holdings_value = excluded.holdings_value`
  );

  const today = new Date().toISOString().slice(0, 10);
  let written = 0;

  const write = db.transaction(() => {
    for (const date of sortedDates) {
      if (date >= today) continue; // today's exact value is recorded live
      if (fxMap && fxMap.has(date)) lastFxRate = fxMap.get(date)!;
      lastFx[date] = lastFxRate;

      let holdingsValue = 0;
      for (const t of Object.keys(seriesByTicker)) {
        const px = seriesByTicker[t].get(date);
        if (px !== undefined) lastPrice[t] = px;
        if (lastPrice[t] === undefined) continue;
        const fx = currencyByTicker[t] === "USD" ? lastFxRate : 1;
        holdingsValue += lastPrice[t] * (unitsByTicker.get(t) || 0) * fx;
      }

      const nw = accountsBase + holdingsValue;
      // Base already nets assets and liabilities; split for the snapshot row.
      const assets = Math.max(accountsBase, 0) + holdingsValue;
      const liabilities = accountsBase < 0 ? -accountsBase : 0;
      upsert.run(`snp_${randomUUID().slice(0, 8)}`, date, nw, assets, liabilities, holdingsValue);
      written += 1;
    }
  });
  write();

  return { written };
}

// Detect dividend events on held tickers and log them: one dividends row per
// holding + an income transaction on the holding's account.
export async function syncDividends(db: Database.Database) {
  const holdings = db
    .prepare(
      `SELECT h.id, h.account_id, UPPER(h.ticker) as ticker, h.units
       FROM holdings h WHERE h.units > 0`
    )
    .all() as { id: string; account_id: string; ticker: string; units: number }[];

  const byTicker = new Map<string, typeof holdings>();
  for (const h of holdings) {
    if (!byTicker.has(h.ticker)) byTicker.set(h.ticker, []);
    byTicker.get(h.ticker)!.push(h);
  }

  const existsStmt = db.prepare(
    "SELECT 1 FROM dividends WHERE holding_id = ? AND ex_date = ?"
  );
  const unitsAtStmt = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN side = 'buy' THEN units ELSE -units END), 0) as units,
            COUNT(*) as trade_count
     FROM trades
     WHERE account_id = ? AND UPPER(ticker) = ? AND trade_date <= ?`
  );
  const holdingCreatedStmt = db.prepare(
    "SELECT created_at FROM holdings WHERE id = ?"
  );

  // Units actually held on the ex-date: derived from trade history where it
  // exists, otherwise the manual holding's current units if it existed by then.
  function unitsHeldAt(
    h: { id: string; account_id: string; ticker: string; units: number },
    exDate: string
  ): number {
    const anyTrades = db
      .prepare(
        "SELECT 1 FROM trades WHERE account_id = ? AND UPPER(ticker) = ? LIMIT 1"
      )
      .get(h.account_id, h.ticker);
    if (anyTrades) {
      const row = unitsAtStmt.get(h.account_id, h.ticker, exDate) as {
        units: number;
      };
      return Math.max(0, row.units);
    }
    const created = holdingCreatedStmt.get(h.id) as { created_at: string };
    return created && created.created_at.slice(0, 10) <= exDate ? h.units : 0;
  }
  const insertDiv = db.prepare(
    `INSERT INTO dividends (id, holding_id, ticker, ex_date, amount)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertTxn = db.prepare(
    `INSERT INTO transactions (id, account_id, date, amount, description, category)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  let recorded = 0;
  const details: string[] = [];

  for (const [ticker, tickerHoldings] of byTicker) {
    const last = db
      .prepare("SELECT MAX(ex_date) as d FROM dividends WHERE UPPER(ticker) = ?")
      .get(ticker) as { d: string | null };
    const since = last?.d
      ? new Date(new Date(last.d).getTime() + 86_400_000)
      : new Date(Date.now() - 90 * 86_400_000);

    const events = await getDividendHistory(ticker, since);
    for (const ev of events) {
      const exDate = ev.date.toISOString().slice(0, 10);
      for (const h of tickerHoldings) {
        if (existsStmt.get(h.id, exDate)) continue;
        const heldUnits = unitsHeldAt(h, exDate);
        if (heldUnits <= 0) continue;
        const total = ev.amount * heldUnits;
        insertDiv.run(
          `div_${randomUUID().slice(0, 8)}`,
          h.id,
          ticker,
          exDate,
          ev.amount
        );
        insertTxn.run(
          `txn_${randomUUID().slice(0, 8)}`,
          h.account_id,
          exDate,
          total,
          `Dividend — ${ticker} (${heldUnits.toLocaleString()} × $${ev.amount.toFixed(4)})`,
          "Dividends"
        );
        recorded += 1;
        details.push(`${ticker} ${exDate} $${total.toFixed(2)}`);
      }
    }
  }

  return { recorded, details };
}
