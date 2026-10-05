import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { categorizeTransactions, agentConfigured, type CategorizeTxn } from "@/lib/agent";
import { recordAgentAssist } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface TxnRow {
  id: string;
  date: string;
  amount: number;
  description: string;
  category: string | null;
}

function categorySets(db: ReturnType<typeof getDb>) {
  const cats = db
    .prepare("SELECT name, type FROM categories ORDER BY name")
    .all() as { name: string; type: string }[];
  const expense = cats.filter((c) => c.type === "expense").map((c) => c.name);
  const income = cats.filter((c) => c.type === "income").map((c) => c.name);
  return { expense, income, all: new Set(cats.map((c) => c.name)) };
}

function uncategorised(db: ReturnType<typeof getDb>, limit = 200): TxnRow[] {
  return db
    .prepare(
      `SELECT id, date, amount, description, category FROM transactions
       WHERE category IS NULL OR TRIM(category) = ''
       ORDER BY date DESC LIMIT ?`
    )
    .all(limit) as TxnRow[];
}

// GET: how many transactions are uncategorised (for the button label).
export async function GET() {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) as n FROM transactions WHERE category IS NULL OR TRIM(category) = ''"
    )
    .get() as { n: number };
  return NextResponse.json({ uncategorised: row.n, configured: agentConfigured() });
}

// POST: propose categories for the uncategorised transactions (no writes).
export async function POST() {
  if (!agentConfigured()) {
    return NextResponse.json(
      { error: "Claude isn't set up yet — add CLAUDE_CODE_OAUTH_TOKEN to the server and restart." },
      { status: 503 }
    );
  }
  const db = getDb();
  const rows = uncategorised(db);
  if (rows.length === 0) {
    return NextResponse.json({ proposals: [] });
  }
  const { expense, income, all } = categorySets(db);

  let assignments;
  try {
    assignments = await categorizeTransactions(
      rows.map((r): CategorizeTxn => ({
        id: r.id,
        date: r.date,
        amount: r.amount,
        description: r.description,
      })),
      expense,
      income
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // Join proposals back to the transactions, keeping only valid category names.
  const byId = new Map(assignments.map((a) => [a.id, a.category]));
  const proposals = rows
    .map((r) => {
      const proposed = byId.get(r.id);
      if (!proposed || !all.has(proposed)) return null;
      return { id: r.id, date: r.date, amount: r.amount, description: r.description, proposed };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return NextResponse.json({ proposals });
}

// PUT: apply the approved {id, category} updates.
export async function PUT(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const { all } = categorySets(db);

  const stmt = db.prepare("UPDATE transactions SET category = ? WHERE id = ?");
  let updated = 0;
  const batch = db.transaction(() => {
    for (const u of updates) {
      if (!u || typeof u.id !== "string" || typeof u.category !== "string") continue;
      if (!all.has(u.category)) continue; // never write a category that doesn't exist
      const res = stmt.run(u.category, u.id);
      if (res.changes > 0) updated += 1;
    }
  });
  batch();

  if (updated > 0) {
    recordAgentAssist(db, {
      feature: "categorize",
      rowCount: updated,
      note: `Applied ${updated} Claude-proposed categories`,
    });
  }
  return NextResponse.json({ updated });
}
