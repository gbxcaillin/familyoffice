import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  const db = getDb();
  const accounts = db
    .prepare(
      `SELECT a.*,
        (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as latest_balance,
        (SELECT b.date FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as latest_balance_date
       FROM accounts a ORDER BY a.type, a.name`
    )
    .all();
  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, owner, institution, currency, notes, balance } = body;

  if (!name || !type || !owner) {
    return NextResponse.json({ error: "Name, type and owner required" }, { status: 400 });
  }

  const db = getDb();
  const id = `acc_${randomUUID().slice(0, 8)}`;

  db.prepare(
    "INSERT INTO accounts (id, name, type, owner, institution, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, type, owner, institution || null, currency || "AUD", notes || null);

  if (balance !== undefined && balance !== null && balance !== "") {
    const balId = `bal_${randomUUID().slice(0, 8)}`;
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT INTO balances (id, account_id, date, balance) VALUES (?, ?, ?, ?)"
    ).run(balId, id, today, parseFloat(balance));
  }

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  return NextResponse.json(account, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
