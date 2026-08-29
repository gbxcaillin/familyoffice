import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getDailySeriesAUD } from "@/lib/market";

interface PositionRow {
  ticker: string;
  units: number;
  name: string | null;
}

const WINDOWS: { key: string; days: number }[] = [
  { key: "m24h", days: 1 },
  { key: "m7d", days: 7 },
  { key: "m1m", days: 30 },
  { key: "m3m", days: 90 },
];

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// The close on the latest date on/before `targetISO`, or null if the series
// doesn't reach that far back.
function closeOnOrBefore(
  series: { date: string; close: number }[],
  targetISO: string
): number | null {
  let found: number | null = null;
  for (const p of series) {
    if (p.date <= targetISO) found = p.close;
    else break;
  }
  return found;
}

// Per-holding and portfolio movement over 24h / 7d / 1m / 3m, derived from a
// single ~95-day daily price series per ticker (one Yahoo fetch each).
export async function GET() {
  const db = getDb();
  const positions = db
    .prepare(
      `SELECT UPPER(h.ticker) as ticker, SUM(h.units) as units, MAX(pc.name) as name
       FROM holdings h
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       GROUP BY UPPER(h.ticker)
       HAVING SUM(h.units) > 0`
    )
    .all() as PositionRow[];

  if (positions.length === 0) {
    return NextResponse.json({ holdings: [], totals: null, asOf: null });
  }

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 100); // buffer beyond the 90-day window

  const series = await getDailySeriesAUD(
    positions.map((p) => p.ticker),
    from,
    to
  );

  // Aggregate the portfolio totals per window as we build the per-holding rows.
  const totNow: Record<string, number> = {};
  const totPast: Record<string, number> = {};
  let asOf: string | null = null;
  let totalValue = 0;

  const holdings = positions.map((p) => {
    const s = series[p.ticker];
    const row: Record<string, unknown> = {
      ticker: p.ticker,
      name: p.name || p.ticker,
      units: p.units,
      value: null,
    };
    for (const w of WINDOWS) row[w.key] = null;

    if (!s || s.length < 2) return row;

    const last = s[s.length - 1];
    const lastClose = last.close;
    if (last.date > (asOf || "")) asOf = last.date;
    const value = p.units * lastClose;
    row.value = value;
    totalValue += value;

    for (const w of WINDOWS) {
      const past = closeOnOrBefore(s, isoMinusDays(last.date, w.days));
      if (past == null || past === 0) continue;
      row[w.key] = ((lastClose - past) / past) * 100;
      totNow[w.key] = (totNow[w.key] || 0) + value;
      totPast[w.key] = (totPast[w.key] || 0) + p.units * past;
    }
    return row;
  });

  const totals: Record<string, unknown> = { value: totalValue };
  for (const w of WINDOWS) {
    const now = totNow[w.key];
    const past = totPast[w.key];
    if (now === undefined || past === undefined || past === 0) {
      totals[w.key] = null;
    } else {
      totals[w.key] = { abs: now - past, pct: ((now - past) / past) * 100 };
    }
  }

  // Sort holdings by value desc so the biggest positions lead.
  holdings.sort((a, b) => ((b.value as number) || 0) - ((a.value as number) || 0));

  return NextResponse.json({ holdings, totals, asOf });
}
