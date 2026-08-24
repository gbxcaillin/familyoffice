import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getQuotes, getQuote, getYahoo } from "@/lib/market";

interface TickerRow {
  ticker: string;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, ticker } = body;

  const db = getDb();

  if (action === "refresh") {
    const tickers = db
      .prepare("SELECT DISTINCT UPPER(ticker) as ticker FROM holdings")
      .all() as TickerRow[];

    if (tickers.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    const tickerList = tickers.map((t) => t.ticker);
    const quotes = await getQuotes(tickerList);

    const upsert = db.prepare(`
      INSERT INTO price_cache (ticker, price, currency, change_percent, day_high, day_low, market_cap, dividend_yield, annual_dividend, name, exchange, updated_at)
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
        updated_at = excluded.updated_at
    `);

    const batch = db.transaction(() => {
      for (const [t, q] of Object.entries(quotes)) {
        upsert.run(
          t,
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
    });
    batch();

    return NextResponse.json({
      updated: Object.keys(quotes).length,
      failed: tickerList.filter((t) => !quotes[t]),
    });
  }

  if (action === "lookup" && ticker) {
    const quote = await getQuote(ticker);
    if (!quote) {
      return NextResponse.json(
        { error: `Could not find ticker: ${ticker}` },
        { status: 404 }
      );
    }
    return NextResponse.json(quote);
  }

  if (action === "search" && ticker) {
    try {
      const yahooFinance = await getYahoo();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any = await yahooFinance.search(ticker);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quotes = (results.quotes || [])
        .filter((q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF")
        .slice(0, 10)
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.shortname || q.longname,
          exchange: q.exchange,
          type: q.quoteType,
        }));
      return NextResponse.json(quotes);
    } catch {
      return NextResponse.json([]);
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
