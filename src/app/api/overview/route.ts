import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getDailySeriesAUD, getQuotes } from "@/lib/market";

interface PositionRow {
  ticker: string;
  units: number;
  name: string | null;
}

// A watchlist of notable AU-listed and global ETFs. "Top ETFs on the market"
// is ranked from this universe by Yahoo's day change — relevant to an Australian
// investor rather than a US-only screener. Edit freely.
const ETF_UNIVERSE: string[] = [
  // Broad Australian
  "VAS.AX", "A200.AX", "IOZ.AX", "STW.AX",
  // Global / US
  "VGS.AX", "VGAD.AX", "IVV.AX", "IWLD.AX", "VOO", "QQQ", "VTI",
  // Thematic / sector
  "NDQ.AX", "FANG.AX", "ETHI.AX", "HACK.AX", "ACDC.AX", "SEMI.AX", "ROBO.AX",
  // Income / property / bonds / gold
  "VHY.AX", "VAP.AX", "VAF.AX", "GOLD.AX", "QUAL.AX",
  // Diversified one-tickers
  "VDHG.AX", "DHHF.AX",
];

// The trading day on/before targetISO, plus the previous trading day, from a
// daily series. Returns the two closes needed for a one-day return.
function dayPair(
  series: { date: string; close: number }[],
  targetISO: string
): { date: string; close: number; prevClose: number } | null {
  let idx = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i].date <= targetISO) idx = i;
    else break;
  }
  if (idx < 1) return null;
  return {
    date: series[idx].date,
    close: series[idx].close,
    prevClose: series[idx - 1].close,
  };
}

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date"); // YYYY-MM-DD, optional

  const positions = db
    .prepare(
      `SELECT UPPER(h.ticker) as ticker, SUM(h.units) as units, MAX(pc.name) as name
       FROM holdings h
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       GROUP BY UPPER(h.ticker)
       HAVING SUM(h.units) > 0`
    )
    .all() as PositionRow[];

  // ---- Our holdings: one-day performance on the chosen (or latest) day ----
  const target = dateParam || new Date().toISOString().slice(0, 10);
  const to = new Date(target + "T00:00:00Z");
  to.setUTCDate(to.getUTCDate() + 1);
  const from = new Date(target + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - 12); // buffer for weekends/holidays

  let holdings: {
    ticker: string;
    name: string;
    units: number;
    price: number;
    value: number;
    ret: number;
  }[] = [];
  let asOf: string | null = null;

  if (positions.length > 0) {
    const series = await getDailySeriesAUD(
      positions.map((p) => p.ticker),
      from,
      to
    );
    for (const p of positions) {
      const s = series[p.ticker];
      if (!s || s.length < 2) continue;
      const pair = dayPair(s, target);
      if (!pair || pair.prevClose === 0) continue;
      const ret = ((pair.close - pair.prevClose) / pair.prevClose) * 100;
      holdings.push({
        ticker: p.ticker.replace(/\.AX$/, ""),
        name: p.name || p.ticker,
        units: p.units,
        price: pair.close,
        value: p.units * pair.close,
        ret,
      });
      if (!asOf || pair.date > asOf) asOf = pair.date;
    }
    holdings = holdings.sort((a, b) => b.ret - a.ret);
  }

  // ---- Market: top ETF movers today from the watchlist (live, via Yahoo) ----
  let etfs: {
    ticker: string;
    name: string;
    price: number;
    changePercent: number;
    currency: string;
  }[] = [];
  try {
    const quotes = await getQuotes(ETF_UNIVERSE);
    etfs = Object.entries(quotes)
      .filter(([, q]) => q && isFinite(q.changePercent))
      .map(([ticker, q]) => ({
        ticker: ticker.replace(/\.AX$/, ""),
        name: q.name || ticker,
        price: q.price,
        changePercent: q.changePercent,
        currency: q.currency,
      }))
      .sort((a, b) => b.changePercent - a.changePercent);
  } catch {
    etfs = [];
  }

  return NextResponse.json({
    requestedDate: target,
    asOf,
    holdings,
    etfs,
  });
}
