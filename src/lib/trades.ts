import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

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
  } else if (existing) {
    db.prepare("DELETE FROM holdings WHERE id = ?").run(existing.id);
  }
}
