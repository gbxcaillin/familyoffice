import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const category = searchParams.get("category");
  const limit = parseInt(searchParams.get("limit") || "200");

  const db = getDb();
  let query = "SELECT t.*, a.name as account_name FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id";
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (accountId) {
    conditions.push("t.account_id = ?");
    params.push(accountId);
  }
  if (category) {
    conditions.push("t.category = ?");
    params.push(category);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY t.date DESC LIMIT ?";
  params.push(limit);

  const transactions = db.prepare(query).all(...params);
  return NextResponse.json(transactions);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { account_id, date, amount, description, category, notes } = body;

  if (!account_id || !date || amount === undefined || !description) {
    return NextResponse.json(
      { error: "account_id, date, amount and description required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = `txn_${randomUUID().slice(0, 8)}`;

  db.prepare(
    "INSERT INTO transactions (id, account_id, date, amount, description, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, account_id, date, parseFloat(amount), description, category || null, notes || null);

  const txn = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  return NextResponse.json(txn, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
