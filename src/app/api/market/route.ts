import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getQuote, getYahoo } from "@/lib/market";
import { refreshAllPrices } from "@/lib/portfolio";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, ticker } = body;

  const db = getDb();

  if (action === "refresh") {
    return NextResponse.json(await refreshAllPrices(db));
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
