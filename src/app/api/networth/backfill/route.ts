import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { backfillSnapshots, recordSnapshot } from "@/lib/portfolio";
import { refreshAllSuper } from "@/lib/super";

// Rebuild net worth history from historical prices. Authenticated via the
// session cookie (the middleware enforces it), triggered from Settings.
export async function POST(request: NextRequest) {
  if (!request.headers.get("x-user-id")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const db = getDb();

  // Clear both histories first so old points from the super drift-bug era
  // (which upsert-on-date would otherwise leave behind between weekly points)
  // are removed, not just overwritten. The rebuild below values everything
  // from current positions/balances, so the curves start clean.
  db.prepare("DELETE FROM snapshots").run();
  try {
    db.prepare("DELETE FROM super_price_history").run();
  } catch {
    // table may not exist on very old schemas
  }

  const result = await backfillSnapshots(db, 365);
  // Re-value super (writes a fresh price-history point) then record today's
  // exact net worth so the trend and movement chips have clean endpoints.
  try {
    await refreshAllSuper(db);
  } catch {
    // non-fatal
  }
  recordSnapshot(db);
  return NextResponse.json(result);
}
