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
        if (quotes.length > 0) seriesByTicker[p.ticker] = quotes;
      } catch {
        // Ticker without history in this window is reported with null returns.
      }
    })
  );

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

  return NextResponse.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    interval,
    perAsset: perAsset.map(({ series: _series, ...rest }) => rest),
    portfolio,
    portfolioReturn,
  });
}
