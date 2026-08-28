import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { backfillSnapshots, recordSnapshot } from "@/lib/portfolio";

// Rebuild net worth history from historical prices. Authenticated via the
// session cookie (the middleware enforces it), triggered from Settings.
export async function POST(request: NextRequest) {
  if (!request.headers.get("x-user-id")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const db = getDb();
  const result = await backfillSnapshots(db, 365);
  recordSnapshot(db); // ensure today's exact point is present too
  return NextResponse.json(result);
}
