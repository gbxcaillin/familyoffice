import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";
import { syncHoldingFromTrades } from "@/lib/trades";
import { getQuote } from "@/lib/market";
import { upsertQuote } from "@/lib/portfolio";

interface IncomingTrade {
  trade_date: string;
  ticker: string;
  side: string;
  units: number;
  price: number;
  fees?: number;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, trades } = body as {
    account_id: string;
    trades: IncomingTrade[];
  };

  if (!account_id || !Array.isArray(trades) || trades.length === 0) {
    return NextResponse.json(
      { error: "account_id and trades required" },
      { status: 400 }
    );
  }
  if (trades.length > 2000) {
    return NextResponse.json({ error: "Too many rows" }, { status: 400 });
  }

  const db = getDb();
  const exists = db.prepare(
    `SELECT 1 FROM trades
     WHERE account_id = ? AND UPPER(ticker) = ? AND side = ? AND trade_date = ?
       AND ABS(units - ?) < 1e-9 AND ABS(price - ?) < 0.005`
  );
  const insert = db.prepare(
    `INSERT INTO trades (id, account_id, ticker, side, units, price, fees, trade_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let imported = 0;
  let skipped = 0;
  const touched = new Set<string>();

  const batch = db.transaction(() => {
    for (const t of trades) {
      const ticker = (t.ticker || "").toUpperCase().trim();
      const side = (t.side || "").toLowerCase();
      if (
        !t.trade_date ||
        !ticker ||
        (side !== "buy" && side !== "sell") ||
        !t.units ||
        t.price === undefined
      ) {
        skipped += 1;
        continue;
      }
      if (exists.get(account_id, ticker, side, t.trade_date, t.units, t.price)) {
        skipped += 1;
        continue;
      }
      insert.run(
        `trd_${randomUUID().slice(0, 8)}`,
        account_id,
        ticker,
        side,
        t.units,
        t.price,
        t.fees || 0,
        t.trade_date
      );
      touched.add(ticker);
      imported += 1;
    }
  });
  batch();

  for (const ticker of touched) {
    syncHoldingFromTrades(db, account_id, ticker);
  }

  // Best-effort: price any tickers new to the cache so positions value now.
  for (const ticker of touched) {
    const cached = db
      .prepare("SELECT 1 FROM price_cache WHERE UPPER(ticker) = ?")
      .get(ticker);
    if (!cached) {
      try {
        const quote = await getQuote(ticker);
        if (quote) upsertQuote(db, ticker, quote);
      } catch {
        // Refresh Prices covers it later.
      }
    }
  }

  return NextResponse.json({ imported, skipped });
}
