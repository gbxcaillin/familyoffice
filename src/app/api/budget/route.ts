import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";

interface BudgetRow {
  id: string;
  category: string;
  monthly: number;
  essential: number;
  sort_order: number;
}

// Budget lines (the plan) plus this-month actuals per category from the
// transactions table (0 until transactions are populated).
export async function GET() {
  const db = getDb();

  const lines = db
    .prepare(
      "SELECT id, category, monthly, essential, sort_order FROM budgets ORDER BY sort_order ASC, category ASC"
    )
    .all() as BudgetRow[];

  // Actual expense this calendar month, by category.
  const actuals = db
    .prepare(
      `SELECT category, SUM(ABS(amount)) as actual
       FROM transactions
       WHERE amount < 0 AND date >= date('now','start of month')
       GROUP BY category`
    )
    .all() as { category: string | null; actual: number }[];
  const actualByCat = new Map<string, number>();
  for (const a of actuals) if (a.category) actualByCat.set(a.category, a.actual);

  // Expense categories for the picker.
  const categories = db
    .prepare("SELECT name, color FROM categories WHERE type = 'expense' ORDER BY name ASC")
    .all() as { name: string; color: string }[];

  const withActuals = lines.map((l) => ({
    ...l,
    essential: l.essential === 1,
    actualThisMonth: actualByCat.get(l.category) ?? 0,
  }));

  const monthlyBudget = lines.reduce((s, l) => s + l.monthly, 0);
  const essentialMonthly = lines.filter((l) => l.essential === 1).reduce((s, l) => s + l.monthly, 0);
  const actualThisMonth = withActuals.reduce((s, l) => s + l.actualThisMonth, 0);

  return NextResponse.json({
    lines: withActuals,
    categories,
    totals: {
      monthlyBudget,
      annualBudget: monthlyBudget * 12,
      essentialMonthly,
      discretionaryMonthly: monthlyBudget - essentialMonthly,
      actualThisMonth,
    },
  });
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!category) {
    return NextResponse.json({ error: "Category required" }, { status: 400 });
  }
  const monthly = Number.isFinite(parseFloat(body.monthly)) ? parseFloat(body.monthly) : 0;
  const essential = body.essential ? 1 : 0;
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM budgets").get() as { m: number }).m;
  const id = `bud_${randomUUID().slice(0, 8)}`;
  db.prepare(
    "INSERT INTO budgets (id, category, monthly, essential, sort_order) VALUES (?, ?, ?, ?, ?)"
  ).run(id, category, monthly, essential, maxOrder + 1);
  return NextResponse.json({ id }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = db.prepare("SELECT * FROM budgets WHERE id = ?").get(id) as BudgetRow | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const category =
    typeof body.category === "string" && body.category.trim() ? body.category.trim() : existing.category;
  const monthly = Number.isFinite(parseFloat(body.monthly)) ? parseFloat(body.monthly) : existing.monthly;
  const essential = body.essential === undefined ? existing.essential : body.essential ? 1 : 0;

  db.prepare("UPDATE budgets SET category = ?, monthly = ?, essential = ? WHERE id = ?").run(
    category,
    monthly,
    essential,
    id
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  db.prepare("DELETE FROM budgets WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
