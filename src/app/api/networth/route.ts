import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { recordSnapshot } from "@/lib/portfolio";
import { refreshAllSuper } from "@/lib/super";

interface BalanceRow {
  date: string;
  total: number;
}

interface SpendRow {
  category: string;
  total: number;
}

export async function GET() {
  const db = getDb();

  // Bring super accounts up to date first (unit price + accrued contributions)
  // so their fresh valuation feeds into today's net worth.
  await refreshAllSuper(db);

  // Record today's true net worth so the trend accumulates a correct point
  // each day the dashboard is viewed (the daily cron does this too).
  const totals = recordSnapshot(db);

  // The trend is built solely from snapshots — each is a full net worth
  // valuation for its day, so the line is always real net worth over time.
  const balanceHistory = db.prepare(`
    SELECT date, total_net_worth as total
    FROM snapshots
    ORDER BY date ASC
  `).all() as BalanceRow[];

  // Net-worth movement over 24h / 7d / 1m / 3m: compare today's total against
  // the snapshot on or nearest before each look-back date. "24h" means "since
  // the previous daily snapshot" — there is no intraday history.
  const latestSnap = db
    .prepare("SELECT date, total_net_worth FROM snapshots ORDER BY date DESC LIMIT 1")
    .get() as { date: string; total_net_worth: number } | undefined;
  const pastAt = db.prepare(
    "SELECT date, total_net_worth FROM snapshots WHERE date <= ? ORDER BY date DESC LIMIT 1"
  );
  const moveOver = (days: number) => {
    if (!latestSnap) return null;
    const target = new Date();
    target.setDate(target.getDate() - days);
    const targetISO = target.toISOString().slice(0, 10);
    const past = pastAt.get(targetISO) as
      | { date: string; total_net_worth: number }
      | undefined;
    // Require the reference point to actually predate today's snapshot.
    if (!past || past.date >= latestSnap.date) return null;
    const abs = latestSnap.total_net_worth - past.total_net_worth;
    const base = Math.abs(past.total_net_worth);
    return { abs, pct: base > 0 ? (abs / base) * 100 : null, from: past.date };
  };
  const movement = {
    d1: moveOver(1),
    d7: moveOver(7),
    d30: moveOver(30),
    d90: moveOver(90),
  };

  const recentSpending = db.prepare(`
    SELECT category, SUM(ABS(amount)) as total
    FROM transactions
    WHERE amount < 0 AND date >= date('now', '-30 days')
    GROUP BY category
    ORDER BY total DESC
  `).all() as SpendRow[];

  const recentIncome = db.prepare(`
    SELECT SUM(amount) as total
    FROM transactions
    WHERE amount > 0 AND date >= date('now', '-30 days')
  `).get() as { total: number | null };

  const recentExpenses = db.prepare(`
    SELECT SUM(ABS(amount)) as total
    FROM transactions
    WHERE amount < 0 AND date >= date('now', '-30 days')
  `).get() as { total: number | null };

  return NextResponse.json({
    ...totals,
    movement,
    balanceHistory,
    recentSpending,
    recentIncome: recentIncome?.total || 0,
    recentExpenses: recentExpenses?.total || 0,
  });
}
