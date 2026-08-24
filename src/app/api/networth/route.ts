import { NextResponse } from "next/server";
import getDb from "@/lib/db";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  owner: string;
  latest_balance: number | null;
}

interface HoldingValueRow {
  account_owner: string;
  account_type: string;
  market_value: number | null;
}

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

  const accounts = db.prepare(`
    SELECT a.id, a.name, a.type, a.owner,
      (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as latest_balance
    FROM accounts a
  `).all() as AccountRow[];

  let totalNetWorth = 0;
  let person1Total = 0;
  let person2Total = 0;
  let jointTotal = 0;
  const byType: Record<string, number> = {};

  for (const acc of accounts) {
    const bal = acc.latest_balance || 0;
    totalNetWorth += bal;
    byType[acc.type] = (byType[acc.type] || 0) + bal;

    if (acc.owner === "person1") person1Total += bal;
    else if (acc.owner === "person2") person2Total += bal;
    else jointTotal += bal;
  }

  const holdingValues = db.prepare(`
    SELECT a.owner as account_owner,
      a.type as account_type,
      SUM(h.units * pc.price) as market_value
    FROM holdings h
    JOIN accounts a ON h.account_id = a.id
    LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
    WHERE pc.price IS NOT NULL
    GROUP BY a.owner, a.type
  `).all() as HoldingValueRow[];

  let holdingsTotal = 0;
  for (const row of holdingValues) {
    const val = row.market_value || 0;
    holdingsTotal += val;
    totalNetWorth += val;
    byType[row.account_type] = (byType[row.account_type] || 0) + val;

    if (row.account_owner === "person1") person1Total += val;
    else if (row.account_owner === "person2") person2Total += val;
    else jointTotal += val;
  }

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

  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const value of Object.values(byType)) {
    if (value >= 0) totalAssets += value;
    else totalLiabilities += -value;
  }

  return NextResponse.json({
    totalNetWorth,
    totalAssets,
    totalLiabilities,
    person1Total,
    person2Total,
    jointTotal,
    holdingsTotal,
    byType,
    balanceHistory,
    recentSpending,
    recentIncome: recentIncome?.total || 0,
    recentExpenses: recentExpenses?.total || 0,
    accountCount: accounts.length,
  });
}
