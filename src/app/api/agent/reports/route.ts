import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The assist log: times the app fell back to Claude because the built-in code
// couldn't handle something. Shown in Settings so the owner can harden the code.
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, feature, file_name, detect_error, result_kind, row_count, note, sample, created_at
       FROM agent_reports ORDER BY created_at DESC LIMIT 200`
    )
    .all();
  return NextResponse.json({ reports: rows });
}

// Clear the whole log, or one entry with ?id=...
export async function DELETE(request: NextRequest) {
  const db = getDb();
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    db.prepare("DELETE FROM agent_reports WHERE id = ?").run(id);
  } else {
    db.prepare("DELETE FROM agent_reports").run();
  }
  return NextResponse.json({ ok: true });
}
