import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { refreshAllSuper } from "@/lib/super";

// Force a super revaluation on demand (unit price + accrued contributions).
export async function POST() {
  const db = getDb();
  const results = await refreshAllSuper(db);
  return NextResponse.json({ refreshed: results.length, results });
}
