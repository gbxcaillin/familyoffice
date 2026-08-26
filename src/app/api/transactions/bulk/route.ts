import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";

interface IncomingTxn {
  date: string;
  amount: number;
  description: string;
  category?: string | null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, transactions } = body as {
    account_id: string;
    transactions: IncomingTxn[];
  };

  if (!account_id || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json(
      { error: "account_id and transactions required" },
      { status: 400 }
    );
  }
  if (transactions.length > 5000) {
    return NextResponse.json({ error: "Too many rows" }, { status: 400 });
  }

  const db = getDb();
  const exists = db.prepare(
    `SELECT 1 FROM transactions
     WHERE account_id = ? AND date = ? AND ABS(amount - ?) < 0.005 AND description = ?`
  );
  const insert = db.prepare(
    `INSERT INTO transactions (id, account_id, date, amount, description, category)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  let imported = 0;
  let skipped = 0;
  const batch = db.transaction(() => {
    for (const t of transactions) {
      if (!t.date || t.amount === undefined || !t.description) {
        skipped += 1;
        continue;
      }
      if (exists.get(account_id, t.date, t.amount, t.description)) {
        skipped += 1;
        continue;
      }
      insert.run(
        `txn_${randomUUID().slice(0, 8)}`,
        account_id,
        t.date,
        t.amount,
        t.description,
        t.category || null
      );
      imported += 1;
    }
  });
  batch();

  return NextResponse.json({ imported, skipped });
}
