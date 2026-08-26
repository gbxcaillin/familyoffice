import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  refreshAllPrices,
  recordSnapshot,
  syncDividends,
} from "@/lib/portfolio";

// Daily job: refresh market prices, log any new dividends as income, and
// record a portfolio valuation snapshot. Called by the server's cron via
// localhost with a shared secret — not by browsers.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.JWT_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const db = getDb();

  const prices = await refreshAllPrices(db);

  let dividends: { recorded: number; details: string[] };
  try {
    dividends = await syncDividends(db);
  } catch {
    dividends = { recorded: 0, details: ["dividend sync failed"] };
  }

  const totals = recordSnapshot(db);

  return NextResponse.json({
    date: new Date().toISOString().slice(0, 10),
    prices,
    dividends,
    snapshot: {
      totalNetWorth: totals.totalNetWorth,
      holdingsValue: totals.holdingsTotal,
    },
  });
}
