import { NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getDividendHistory, getUsdToAudRate } from "@/lib/market";

interface PositionRow {
  ticker: string;
  units: number;
  name: string | null;
  currency: string | null;
}

// Forward 12-month distribution projection. For each held ticker we read the
// trailing ~13 months of distributions from Yahoo, infer the pay cadence and a
// representative per-unit amount, then roll that forward at the current unit
// count. It's an estimate (labelled as such) — a passive-income runway, not a
// promise.
export async function GET() {
  const db = getDb();

  const positions = db
    .prepare(
      `SELECT UPPER(h.ticker) as ticker, SUM(h.units) as units, MAX(pc.name) as name,
              MAX(pc.currency) as currency
       FROM holdings h
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       GROUP BY UPPER(h.ticker)
       HAVING SUM(h.units) > 0`
    )
    .all() as PositionRow[];

  if (positions.length === 0) {
    return NextResponse.json({
      events: [],
      byMonth: [],
      next90Total: 0,
      next12mTotal: 0,
      trailing12mTotal: 0,
    });
  }

  const fxUsd = (await getUsdToAudRate()) || 1;
  const now = new Date();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 365);
  const lookback = new Date();
  lookback.setDate(lookback.getDate() - 400);

  type Ev = {
    ticker: string;
    name: string;
    exDate: string;
    perUnit: number; // AUD
    amount: number; // AUD (perUnit * units)
    units: number;
    projected: boolean;
  };

  const results = await Promise.all(
    positions.map(async (p) => {
      const out: Ev[] = [];
      let trailing = 0;
      let events;
      try {
        events = await getDividendHistory(p.ticker, lookback);
      } catch {
        return { out, trailing };
      }
      if (!events || events.length === 0) return { out, trailing };

      const fx = p.currency === "USD" ? fxUsd : 1;
      const name = p.name || p.ticker;
      const label = p.ticker.replace(/\.AX$/, "");

      // Sort ascending; keep the trailing 13 months.
      const sorted = events
        .map((e) => ({ date: e.date, amount: e.amount * fx }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      const yearAgo = new Date();
      yearAgo.setDate(yearAgo.getDate() - 365);
      const last12 = sorted.filter((e) => e.date >= yearAgo);
      trailing = last12.reduce((s, e) => s + e.amount * p.units, 0);

      // Cadence + representative amount from recent history.
      const count = Math.max(1, last12.length);
      const intervalDays = 365 / count;
      const recentForAmt = last12.length ? last12 : sorted.slice(-4);
      const avgPerUnit =
        recentForAmt.reduce((s, e) => s + e.amount, 0) / recentForAmt.length;
      const lastEx = sorted[sorted.length - 1].date;

      // Roll forward from the last known ex-date at the inferred cadence.
      let d = new Date(lastEx);
      for (let i = 0; i < 24; i++) {
        d = new Date(d.getTime() + intervalDays * 86_400_000);
        if (d > horizon) break;
        if (d <= now) continue;
        out.push({
          ticker: label,
          name,
          exDate: d.toISOString().slice(0, 10),
          perUnit: avgPerUnit,
          amount: avgPerUnit * p.units,
          units: p.units,
          projected: true,
        });
      }
      return { out, trailing };
    })
  );

  const events = results.flatMap((r) => r.out).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const trailing12mTotal = results.reduce((s, r) => s + r.trailing, 0);

  const in90 = new Date();
  in90.setDate(in90.getDate() + 90);
  const in90ISO = in90.toISOString().slice(0, 10);
  const next90Total = events
    .filter((e) => e.exDate <= in90ISO)
    .reduce((s, e) => s + e.amount, 0);
  const next12mTotal = events.reduce((s, e) => s + e.amount, 0);

  // Aggregate by calendar month for a simple bar chart.
  const monthMap = new Map<string, number>();
  for (const e of events) {
    const m = e.exDate.slice(0, 7); // YYYY-MM
    monthMap.set(m, (monthMap.get(m) || 0) + e.amount);
  }
  const byMonth = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));

  return NextResponse.json({
    events,
    byMonth,
    next90Total,
    next12mTotal,
    trailing12mTotal,
  });
}
