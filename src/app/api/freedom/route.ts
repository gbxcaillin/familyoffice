import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  computeFreedom,
  getFireSettings,
  setSetting,
  DEFAULT_FIRE,
  type FireSettings,
} from "@/lib/insights";

// The Freedom Number: FIRE target, progress, projected date and Coast FIRE,
// computed from current net worth plus derived (or manually set) spend/savings.
export async function GET() {
  const db = getDb();
  return NextResponse.json(computeFreedom(db));
}

// Save the household FIRE assumptions (shared, not per-user). Only known fields
// are accepted; blanks fall back to the current/default value.
export async function PUT(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const cur = getFireSettings(db);

  const numOr = (v: unknown, fallback: number): number =>
    v !== undefined && v !== null && v !== "" && isFinite(parseFloat(v as string))
      ? parseFloat(v as string)
      : fallback;
  const numOrNull = (v: unknown, fallback: number | null): number | null =>
    v === null || v === "" ? null : v === undefined ? fallback : numOr(v, fallback ?? 0);

  const next: FireSettings = {
    swr: Math.min(10, Math.max(1, numOr(body.swr, cur.swr))),
    realReturn: Math.min(15, Math.max(0, numOr(body.realReturn, cur.realReturn))),
    annualSpend: numOrNull(body.annualSpend, cur.annualSpend),
    targetOverride: numOrNull(body.targetOverride, cur.targetOverride),
    includeHome:
      typeof body.includeHome === "boolean" ? body.includeHome : cur.includeHome,
    currentAge: numOrNull(body.currentAge, cur.currentAge),
    retireAge: Math.min(90, Math.max(30, numOr(body.retireAge, cur.retireAge || DEFAULT_FIRE.retireAge))),
  };

  setSetting(db, "fire", next);
  return NextResponse.json(computeFreedom(db));
}
