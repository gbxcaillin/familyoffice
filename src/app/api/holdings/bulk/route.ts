import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";
import { getQuote } from "@/lib/market";
import { upsertQuote } from "@/lib/portfolio";
import { accountHasTrades, reconcileHoldingUnits } from "@/lib/trades";

interface IncomingHolding {
  ticker: string;
  name?: string | null;
  units: number;
  cost_basis?: number;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, holdings, cash } = body as {
    account_id: string;
    holdings: IncomingHolding[];
    cash?: number | null;
  };

  if (!account_id || !Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json(
      { error: "account_id and holdings required" },
      { status: 400 }
    );
  }
  if (holdings.length > 2000) {
    return NextResponse.json({ error: "Too many rows" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM holdings WHERE account_id = ? AND UPPER(ticker) = UPPER(?)"
  );
  const insert = db.prepare(
    `INSERT INTO holdings (id, account_id, ticker, name, units, cost_basis)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE holdings SET units = ?, cost_basis = ?, name = COALESCE(name, ?), updated_at = datetime('now') WHERE id = ?`
  );

  let imported = 0;
  let updated = 0;
  let reconciled = 0;
  const touched = new Set<string>();
  // Tickers that already have a trade history: keep their trade-derived cost
  // basis and just reconcile units to the valuation, rather than overwriting.
  const reconcileTargets = new Map<string, number>();

  const batch = db.transaction(() => {
    for (const h of holdings) {
      const ticker = (h.ticker || "").toUpperCase().trim();
      if (!ticker || !h.units || h.units <= 0) continue;

      if (accountHasTrades(db, account_id, ticker)) {
        // Trades own the cost basis; remember the valuation units to top up to.
        reconcileTargets.set(ticker, h.units);
        continue;
      }

      const cost = h.cost_basis && h.cost_basis > 0 ? h.cost_basis : 0;
      const row = existing.get(account_id, ticker) as { id: string } | undefined;
      if (row) {
        update.run(h.units, cost, h.name || null, row.id);
        updated += 1;
      } else {
        insert.run(
          `hld_${randomUUID().slice(0, 8)}`,
          account_id,
          ticker,
          h.name || null,
          h.units,
          cost
        );
        imported += 1;
      }
      touched.add(ticker);
    }
  });
  batch();

  // For tickers with existing trades, reconcile units up to the valuation
  // (adds DRP top-up units) without touching the trade cost basis.
  for (const [ticker, target] of reconcileTargets) {
    const before = db
      .prepare("SELECT units FROM holdings WHERE account_id = ? AND UPPER(ticker) = UPPER(?)")
      .get(account_id, ticker) as { units: number } | undefined;
    reconcileHoldingUnits(db, account_id, ticker, target);
    const after = db
      .prepare("SELECT units FROM holdings WHERE account_id = ? AND UPPER(ticker) = UPPER(?)")
      .get(account_id, ticker) as { units: number } | undefined;
    if (after && (!before || after.units > before.units + 1e-6)) reconciled += 1;
  }

  // Record the account's cash balance if one was supplied.
  if (cash !== undefined && cash !== null && !isNaN(cash)) {
    const today = new Date().toISOString().slice(0, 10);
    const existingBal = db
      .prepare("SELECT id FROM balances WHERE account_id = ? AND date = ?")
      .get(account_id, today) as { id: string } | undefined;
    if (existingBal) {
      db.prepare("UPDATE balances SET balance = ? WHERE id = ?").run(
        cash,
        existingBal.id
      );
    } else {
      db.prepare(
        "INSERT INTO balances (id, account_id, date, balance, notes) VALUES (?, ?, ?, ?, ?)"
      ).run(
        `bal_${randomUUID().slice(0, 8)}`,
        account_id,
        today,
        cash,
        "Cash from holdings import"
      );
    }
  }

  // Best-effort: fetch live quotes so the positions value immediately.
  for (const ticker of touched) {
    try {
      const quote = await getQuote(ticker);
      if (quote) upsertQuote(db, ticker, quote);
    } catch {
      // Refresh Prices covers it later.
    }
  }

  return NextResponse.json({ imported, updated, reconciled });
}
