import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");

  const db = getDb();

  if (accountId) {
    const balances = db
      .prepare("SELECT * FROM balances WHERE account_id = ? ORDER BY date DESC")
      .all(accountId);
    return NextResponse.json(balances);
  }

  const balances = db
    .prepare("SELECT * FROM balances ORDER BY date DESC LIMIT 500")
    .all();
  return NextResponse.json(balances);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, date, balance, notes } = body;

  if (!account_id || !date || balance === undefined) {
    return NextResponse.json({ error: "account_id, date and balance required" }, { status: 400 });
  }

  const db = getDb();
  const id = `bal_${randomUUID().slice(0, 8)}`;

  db.prepare(
    "INSERT INTO balances (id, account_id, date, balance, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(id, account_id, date, parseFloat(balance), notes || null);

  const entry = db.prepare("SELECT * FROM balances WHERE id = ?").get(id);
  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM balances WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
