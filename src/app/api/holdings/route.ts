import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";

interface HoldingRow {
  id: string;
  account_id: string;
  account_name: string;
  account_owner: string;
  ticker: string;
  name: string | null;
  units: number;
  cost_basis: number;
  currency: string;
  notes: string | null;
  cached_price: number | null;
  cached_change_percent: number | null;
  cached_dividend_yield: number | null;
  cached_annual_dividend: number | null;
  cached_name: string | null;
  cached_exchange: string | null;
  price_updated_at: string | null;
}

export async function GET() {
  const db = getDb();
  const holdings = db
    .prepare(
      `SELECT h.*,
        a.name as account_name,
        a.owner as account_owner,
        pc.price as cached_price,
        pc.change_percent as cached_change_percent,
        pc.dividend_yield as cached_dividend_yield,
        pc.annual_dividend as cached_annual_dividend,
        pc.name as cached_name,
        pc.exchange as cached_exchange,
        pc.updated_at as price_updated_at
       FROM holdings h
       JOIN accounts a ON h.account_id = a.id
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       ORDER BY h.ticker, a.name`
    )
    .all() as HoldingRow[];

  const enriched = holdings.map((h) => {
    const marketValue = h.cached_price ? h.units * h.cached_price : null;
    const totalCost = h.cost_basis * h.units;
    const gainLoss = marketValue !== null ? marketValue - totalCost : null;
    const gainLossPercent =
      gainLoss !== null && totalCost > 0
        ? (gainLoss / totalCost) * 100
        : null;
    const annualIncome =
      h.cached_annual_dividend !== null
        ? h.cached_annual_dividend * h.units
        : null;

    return {
      ...h,
      market_value: marketValue,
      total_cost: totalCost,
      gain_loss: gainLoss,
      gain_loss_percent: gainLossPercent,
      annual_income: annualIncome,
      display_name: h.cached_name || h.name || h.ticker,
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, ticker, name, units, cost_basis, currency, notes } = body;

  if (!account_id || !ticker || units === undefined) {
    return NextResponse.json(
      { error: "account_id, ticker and units required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = `hld_${randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO holdings (id, account_id, ticker, name, units, cost_basis, currency, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    account_id,
    ticker.toUpperCase().trim(),
    name || null,
    parseFloat(units),
    parseFloat(cost_basis || "0"),
    currency || "AUD",
    notes || null
  );

  const holding = db.prepare("SELECT * FROM holdings WHERE id = ?").get(id);
  return NextResponse.json(holding, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, units, cost_basis, notes } = body;

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `UPDATE holdings SET units = ?, cost_basis = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(parseFloat(units), parseFloat(cost_basis || "0"), notes || null, id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM holdings WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
