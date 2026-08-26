import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { DEFAULT_PREFS, sanitisePrefs } from "@/lib/prefs";

// Per-user layout preferences. The middleware puts the authenticated user id
// in x-user-id, so each person gets their own layout.
export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id");
  if (!userId) return NextResponse.json(DEFAULT_PREFS);

  const db = getDb();
  const row = db
    .prepare("SELECT prefs FROM user_prefs WHERE user_id = ?")
    .get(userId) as { prefs: string } | undefined;

  if (!row) return NextResponse.json(DEFAULT_PREFS);
  try {
    return NextResponse.json(sanitisePrefs(JSON.parse(row.prefs)));
  } catch {
    return NextResponse.json(DEFAULT_PREFS);
  }
}

export async function PUT(request: NextRequest) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const prefs = sanitisePrefs(body);

  const db = getDb();
  db.prepare(
    `INSERT INTO user_prefs (user_id, prefs, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(prefs));

  return NextResponse.json(prefs);
}
