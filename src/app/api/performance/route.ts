/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getYahoo } from "@/lib/market";

interface PositionRow {
  ticker: string;
  units: number;
  cost_basis: number;
  name: string | null;
}

function yearsAgo(n: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}

// Annualised internal rate of return for dated cashflows, via bisection.
function xirr(flows: { date: Date; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  const t0 = flows[0].date.getTime();
  const years = flows.map(
    (f) => (f.date.getTime() - t0) / (365.25 * 86_400_000)
  );
  const npv = (r: number) =>
    flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);

  let lo = -0.999;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (Math.abs(fmid) < 1e-7) return mid;
    if (flo * fmid < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

// Money-weighted return since inception: every buy/sell as a dated cashflow,
// plus today's market value of positions that came from those trades.
function computeMoneyWeightedReturn(db: any): number | null {
  const trades = db
    .prepare(
      `SELECT trade_date, side, units, price, fees, account_id, UPPER(ticker) as ticker
       FROM trades ORDER BY trade_date ASC`
    )
    .all() as {
    trade_date: string;
    side: string;
    units: number;
    price: number;
    fees: number;
    account_id: string;
    ticker: string;
  }[];

  if (trades.length === 0) return null;

  const flows = trades.map((t) => ({
    date: new Date(t.trade_date),
    amount:
      t.side === "buy"
        ? -(t.units * t.price + t.fees)
        : t.units * t.price - t.fees,
  }));

  const tradedKeys = new Set(trades.map((t) => `${t.account_id}:${t.ticker}`));
  const positions = db
    .prepare(
      `SELECT h.account_id, UPPER(h.ticker) as ticker, h.units, pc.price
       FROM holdings h
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       WHERE h.units > 0 AND pc.price IS NOT NULL`
    )
    .all() as { account_id: string; ticker: string; units: number; price: number }[];

  let terminal = 0;
  for (const p of positions) {
    if (tradedKeys.has(`${p.account_id}:${p.ticker}`)) {
      terminal += p.units * p.price;
    }
  }
  if (terminal > 0) flows.push({ date: new Date(), amount: terminal });

  const rate = xirr(flows);
  return rate === null ? null : rate * 100;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "1y";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const db = getDb();

  const positions = db
    .prepare(
      `SELECT UPPER(h.ticker) as ticker,
        SUM(h.units) as units,
        SUM(h.units * h.cost_basis) / SUM(h.units) as cost_basis,
        MAX(pc.name) as name
       FROM holdings h
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       GROUP BY UPPER(h.ticker)
       HAVING SUM(h.units) > 0`
    )
    .all() as PositionRow[];

  if (positions.length === 0) {
    return NextResponse.json({
      perAsset: [],
      portfolio: [],
      portfolioReturn: null,
    });
  }

  const to = toParam ? new Date(toParam) : new Date();
  let from: Date;
  if (fromParam) {
    from = new Date(fromParam);
  } else if (period === "all") {
    const first = db
      .prepare("SELECT MIN(trade_date) as d FROM trades")
      .get() as { d: string | null };
    from = first?.d ? new Date(first.d) : yearsAgo(5);
  } else {
    const years = period === "5y" ? 5 : period === "3y" ? 3 : 1;
    from = yearsAgo(years);
  }

  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
    return NextResponse.json(
      { error: "Invalid date range" },
      { status: 400 }
    );
  }

  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  const interval = spanDays <= 400 ? "1d" : "1wk";

  const yahooFinance = await getYahoo();

  const seriesByTicker: Record<string, { date: string; close: number }[]> = {};
  const currencyByTicker: Record<string, string> = {};

  await Promise.all(
    positions.map(async (p) => {
      try {
        const result: any = await yahooFinance.chart(p.ticker, {
          period1: from,
          period2: to,
          interval: interval as any,
        });
        const quotes = (result?.quotes || [])
          .filter((q: any) => q.close !== null && q.close !== undefined)
          .map((q: any) => ({
            date: new Date(q.date).toISOString().slice(0, 10),
            close: q.close as number,
          }));
        if (quotes.length > 0) {
          seriesByTicker[p.ticker] = quotes;
          currencyByTicker[p.ticker] = result?.meta?.currency || "AUD";
        }
      } catch {
        // Ticker without history in this window is reported with null returns.
      }
    })
  );

  // Convert USD-denominated series to AUD using the historical USD/AUD rate,
  // forward-filled to each price date.
  const usdTickers = Object.keys(seriesByTicker).filter(
    (t) => currencyByTicker[t] === "USD"
  );
  if (usdTickers.length > 0) {
    try {
      const fxResult: any = await yahooFinance.chart("AUD=X", {
        period1: from,
        period2: to,
        interval: interval as any,
      });
      const fxSeries = (fxResult?.quotes || [])
        .filter((q: any) => q.close !== null && q.close !== undefined)
        .map((q: any) => ({
          date: new Date(q.date).toISOString().slice(0, 10),
          close: q.close as number,
        }));
      if (fxSeries.length > 0) {
        const fxMap = new Map<string, number>(
          fxSeries.map((q: { date: string; close: number }) => [q.date, q.close])
        );
        const fxDates = fxSeries.map((q: { date: string }) => q.date).sort();
        const rateAt = (date: string): number => {
          if (fxMap.has(date)) return fxMap.get(date)!;
          let last = fxSeries[0].close;
          for (const d of fxDates) {
            if (d > date) break;
            last = fxMap.get(d)!;
          }
          return last;
        };
        for (const t of usdTickers) {
          seriesByTicker[t] = seriesByTicker[t].map((q) => ({
            date: q.date,
            close: q.close * rateAt(q.date),
          }));
        }
      }
    } catch {
      // If FX history is unavailable the USD series stays unconverted.
    }
  }

  const perAsset = positions.map((p) => {
    const series = seriesByTicker[p.ticker];
    if (!series || series.length < 2) {
      return {
        ticker: p.ticker,
        name: p.name || p.ticker,
        units: p.units,
        cost_basis: p.cost_basis,
        startPrice: null,
        endPrice: null,
        changePercent: null,
        startValue: null,
        endValue: null,
        series: series || [],
      };
    }
    const startPrice = series[0].close;
    const endPrice = series[series.length - 1].close;
    return {
      ticker: p.ticker,
      name: p.name || p.ticker,
      units: p.units,
      cost_basis: p.cost_basis,
      startPrice,
      endPrice,
      changePercent: ((endPrice - startPrice) / startPrice) * 100,
      startValue: startPrice * p.units,
      endValue: endPrice * p.units,
      series,
    };
  });

  // Portfolio value series: current units priced at each date, forward-filling
  // gaps, starting once every ticker has at least one observed price.
  const tickersWithData = Object.keys(seriesByTicker);
  const priceMaps: Record<string, Map<string, number>> = {};
  const allDates = new Set<string>();
  for (const t of tickersWithData) {
    priceMaps[t] = new Map(seriesByTicker[t].map((q) => [q.date, q.close]));
    for (const q of seriesByTicker[t]) allDates.add(q.date);
  }
  const sortedDates = [...allDates].sort();
  const lastKnown: Record<string, number> = {};
  const unitsByTicker: Record<string, number> = Object.fromEntries(
    positions.map((p) => [p.ticker, p.units])
  );

  const portfolio: { date: string; total: number }[] = [];
  for (const date of sortedDates) {
    for (const t of tickersWithData) {
      const px = priceMaps[t].get(date);
      if (px !== undefined) lastKnown[t] = px;
    }
    if (tickersWithData.every((t) => lastKnown[t] !== undefined)) {
      const total = tickersWithData.reduce(
        (sum, t) => sum + lastKnown[t] * (unitsByTicker[t] || 0),
        0
      );
      portfolio.push({ date, total });
    }
  }

  const portfolioReturn =
    portfolio.length >= 2 && portfolio[0].total > 0
      ? ((portfolio[portfolio.length - 1].total - portfolio[0].total) /
          portfolio[0].total) *
        100
      : null;

  let moneyWeightedReturn: number | null = null;
  try {
    moneyWeightedReturn = computeMoneyWeightedReturn(db);
  } catch {
    // Optional metric; never fail the endpoint over it.
  }

  return NextResponse.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    interval,
    perAsset: perAsset.map(({ series: _series, ...rest }) => rest),
    portfolio,
    portfolioReturn,
    moneyWeightedReturn,
  });
}
