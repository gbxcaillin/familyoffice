import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { detectAnomalies } from "@/lib/insights";

// Self-diagnosing checks over the stored data: implausible net-worth jumps,
// stale snapshots/prices, drifted super anchors, big daily moves, pending DRP.
export async function GET() {
  const db = getDb();
  const anomalies = detectAnomalies(db);
  return NextResponse.json({ anomalies, checkedAt: new Date().toISOString() });
}
