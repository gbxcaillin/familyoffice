import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { computeNetWorth, recordSnapshot } from "@/lib/portfolio";

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
    balanceHistory,
    recentSpending,
    recentIncome: recentIncome?.total || 0,
    recentExpenses: recentExpenses?.total || 0,
  });
}
