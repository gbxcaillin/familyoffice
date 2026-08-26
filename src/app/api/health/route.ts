import { NextResponse } from "next/server";
import getDb from "@/lib/db";

// Unauthenticated liveness probe for uptime monitoring. Exposes no data.
export async function GET() {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
