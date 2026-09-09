import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

export function accountHasTrades(
  db: Database.Database,
  accountId: string,
  ticker: string
): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM trades WHERE account_id = ? AND UPPER(ticker) = UPPER(?) LIMIT 1"
    )
    .get(accountId, ticker);
}

// Reconcile a trade-derived position up to a known target unit count (from a
// holdings valuation). The shortfall is almost always dividend-reinvestment
// (DRP) units the cash report never itemises, so top them up with one
// synthetic buy at the current average cost — units then match the statement
// while the real cost basis and performance from the trades are preserved.
export function reconcileHoldingUnits(
  db: Database.Database,
  accountId: string,
  ticker: string,
  targetUnits: number
) {
  if (!accountHasTrades(db, accountId, ticker)) return; // nothing to reconcile
  syncHoldingFromTrades(db, accountId, ticker);
  const holding = db
    .prepare(
      "SELECT units, cost_basis FROM holdings WHERE account_id = ? AND UPPER(ticker) = UPPER(?)"
    )
    .get(accountId, ticker) as { units: number; cost_basis: number } | undefined;
  const current = holding ? holding.units : 0;
  const gap = targetUnits - current;
  if (gap <= 1e-6) return; // trades already meet or exceed the target

  const avg = holding ? holding.cost_basis : 0;
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO trades (id, account_id, ticker, side, units, price, fees, trade_date, notes)
     VALUES (?, ?, ?, 'buy', ?, ?, 0, ?, ?)`
  ).run(
    `trd_${randomUUID().slice(0, 8)}`,
    accountId,
    ticker.toUpperCase().trim(),
    gap,
    avg,
    today,
    "DRP / reconciled to statement holdings"
  );
  syncHoldingFromTrades(db, accountId, ticker);
}

// Recompute the holdings row for an account+ticker from its trade history
// using the average-cost method. A fully exited position removes the holding.
export function syncHoldingFromTrades(
  db: Database.Database,
  accountId: string,
  ticker: string
) {
  const trades = db
    .prepare(
      `SELECT side, units, price, fees FROM trades
       WHERE account_id = ? AND UPPER(ticker) = UPPER(?)
       ORDER BY trade_date ASC, created_at ASC`
    )
    .all(accountId, ticker) as {
    side: string;
    units: number;
    price: number;
    fees: number;
  }[];

  let units = 0;
  let totalCost = 0;
  for (const t of trades) {
    if (t.side === "buy") {
      totalCost += t.units * t.price + t.fees;
      units += t.units;
    } else {
      const avg = units > 0 ? totalCost / units : 0;
      units = Math.max(0, units - t.units);
      totalCost = avg * units;
    }
  }

  const existing = db
    .prepare(
      "SELECT id FROM holdings WHERE account_id = ? AND UPPER(ticker) = UPPER(?)"
    )
    .get(accountId, ticker) as { id: string } | undefined;

  if (units > 1e-9) {
    const avgCost = totalCost / units;
    if (existing) {
      db.prepare(
        `UPDATE holdings SET units = ?, cost_basis = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(units, avgCost, existing.id);
    } else {
      db.prepare(
        `INSERT INTO holdings (id, account_id, ticker, units, cost_basis)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        `hld_${randomUUID().slice(0, 8)}`,
        accountId,
        ticker.toUpperCase().trim(),
        units,
        avgCost
      );
    }
  }
  // If the trades net to zero we do NOT delete the holding. A trade import is
  // often partial (only some history, or a cash report), and silently wiping a
  // position that was established from a holdings statement is destructive and
  // hard to notice. Leave the existing units untouched; a genuinely closed
  // position can be removed manually or corrected by a holdings-statement import.
}
