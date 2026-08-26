import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getQuote } from "@/lib/market";
import { upsertQuote } from "@/lib/portfolio";
import { syncHoldingFromTrades } from "@/lib/trades";
import { randomUUID } from "crypto";

interface TradeRow {
  id: string;
  account_id: string;
  account_name: string;
  ticker: string;
  side: "buy" | "sell";
  units: number;
  price: number;
  fees: number;
  trade_date: string;
  notes: string | null;
  created_at: string;
}

export async function GET() {
  const db = getDb();
  const trades = db
    .prepare(
      `SELECT t.*, a.name as account_name
       FROM trades t
       JOIN accounts a ON t.account_id = a.id
       ORDER BY t.trade_date ASC, t.created_at ASC`
    )
    .all() as TradeRow[];

  // Walk each position chronologically to attach realised P&L to sells.
  const positions: Record<string, { units: number; cost: number }> = {};
  let totalRealised = 0;

  const annotated = trades.map((t) => {
    const key = `${t.account_id}:${t.ticker.toUpperCase()}`;
    const pos = (positions[key] ||= { units: 0, cost: 0 });

    let realised: number | null = null;
    let avgCostAtSale: number | null = null;

    if (t.side === "buy") {
      pos.cost += t.units * t.price + t.fees;
      pos.units += t.units;
    } else {
      avgCostAtSale = pos.units > 0 ? pos.cost / pos.units : 0;
      realised = (t.price - avgCostAtSale) * t.units - t.fees;
      totalRealised += realised;
      pos.units = Math.max(0, pos.units - t.units);
      pos.cost = avgCostAtSale * pos.units;
    }

    return {
      ...t,
      total_value: t.units * t.price,
      realised,
      avg_cost_at_sale: avgCostAtSale,
    };
  });

  // Newest first for display
  annotated.reverse();

  return NextResponse.json({ trades: annotated, totalRealised });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, ticker, side, units, price, fees, trade_date, notes } =
    body;

  if (!account_id || !ticker || !side || !units || price === undefined || !trade_date) {
    return NextResponse.json(
      { error: "account_id, ticker, side, units, price and trade_date required" },
      { status: 400 }
    );
  }

  if (side !== "buy" && side !== "sell") {
    return NextResponse.json(
      { error: "side must be 'buy' or 'sell'" },
      { status: 400 }
    );
  }

  const db = getDb();
  const cleanTicker = ticker.toUpperCase().trim();
  const id = `trd_${randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO trades (id, account_id, ticker, side, units, price, fees, trade_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    account_id,
    cleanTicker,
    side,
    parseFloat(units),
    parseFloat(price),
    parseFloat(fees || "0"),
    trade_date,
    notes || null
  );

  syncHoldingFromTrades(db, account_id, cleanTicker);

  // Best-effort: cache a live quote so the new position prices immediately.
  try {
    const quote = await getQuote(cleanTicker);
    if (quote) upsertQuote(db, cleanTicker, quote);
  } catch {
    // Quote refresh is optional; the trade itself is already saved.
  }

  const trade = db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
  return NextResponse.json(trade, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  const trade = db
    .prepare("SELECT account_id, ticker FROM trades WHERE id = ?")
    .get(id) as { account_id: string; ticker: string } | undefined;

  if (!trade) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }

  db.prepare("DELETE FROM trades WHERE id = ?").run(id);
  syncHoldingFromTrades(db, trade.account_id, trade.ticker);

  return NextResponse.json({ ok: true });
}
