import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { computeNetWorth } from "@/lib/portfolio";

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

  const totals = computeNetWorth(db);

  // Daily snapshots (written by the cron job) are the preferred trend source;
  // manual balance history is the fallback for the period before they existed.
  const snapshotHistory = db.prepare(`
    SELECT date, total_net_worth as total
    FROM snapshots
    ORDER BY date ASC
  `).all() as BalanceRow[];

  const balanceHistory = db.prepare(`
    SELECT b.date, SUM(b.balance) as total
    FROM balances b
    INNER JOIN (
      SELECT account_id, date, MAX(rowid) as max_rowid
      FROM balances
      GROUP BY account_id, date
    ) latest ON b.account_id = latest.account_id AND b.date = latest.date AND b.rowid = latest.max_rowid
    GROUP BY b.date
    ORDER BY b.date ASC
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
    balanceHistory:
      snapshotHistory.length >= 2 ? snapshotHistory : balanceHistory,
    recentSpending,
    recentIncome: recentIncome?.total || 0,
    recentExpenses: recentExpenses?.total || 0,
  });
}
