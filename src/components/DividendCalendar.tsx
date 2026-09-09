"use client";

import { useEffect, useState } from "react";

interface DivEvent {
  ticker: string;
  name: string;
  exDate: string;
  perUnit: number;
  amount: number;
  units: number;
  projected: boolean;
}
interface MonthBar {
  month: string; // YYYY-MM
  total: number;
}
interface CalendarData {
  events: DivEvent[];
  byMonth: MonthBar[];
  next90Total: number;
  next12mTotal: number;
  trailing12mTotal: number;
}

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
const fmt2 = (v: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(v);

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", { month: "short" });
}
function exLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function DividendCalendar() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/dividends/calendar")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white border border-gbx-border p-6">
        <p className="text-gbx-muted font-body text-sm">Loading distribution calendar…</p>
      </div>
    );
  }
  if (!data) return null;

  const hasData = data.events.length > 0;
  const maxMonth = Math.max(1, ...data.byMonth.map((m) => m.total));
  const upcoming = showAll ? data.events : data.events.slice(0, 6);

  return (
    <div className="bg-white border border-gbx-border p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
          Distribution Calendar
        </h2>
        <span className="text-[11px] text-gbx-muted font-body">Projected · estimate</span>
      </div>

      {!hasData ? (
        <p className="text-sm text-gbx-muted font-body">
          No distribution history found for your holdings yet. Once dividend-paying
          holdings are tracked, a 12-month income forecast appears here.
        </p>
      ) : (
        <>
          {/* Headline totals */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-gbx-soft p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body">Next 90 days</p>
              <p className="font-data text-lg text-gbx-charcoal mt-0.5">{fmt0(data.next90Total)}</p>
            </div>
            <div className="bg-gbx-soft p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body">Next 12 months</p>
              <p className="font-data text-lg text-gbx-teal mt-0.5">{fmt0(data.next12mTotal)}</p>
            </div>
            <div className="bg-gbx-soft p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body">Last 12 months</p>
              <p className="font-data text-lg text-gbx-charcoal mt-0.5">{fmt0(data.trailing12mTotal)}</p>
            </div>
          </div>

          {/* Monthly bars */}
          {data.byMonth.length > 0 && (
            <div className="mb-5">
              <div className="flex items-end gap-1.5 h-24">
                {data.byMonth.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${m.month}: ${fmt0(m.total)}`}>
                    <div
                      className="w-full bg-gbx-teal/80 hover:bg-gbx-teal transition-colors"
                      style={{ height: `${Math.max(2, (m.total / maxMonth) * 100)}%` }}
                    />
                    <span className="text-[9px] text-gbx-muted font-data">{monthLabel(m.month)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming payments */}
          <p className="text-[10px] uppercase tracking-[0.15em] text-gbx-muted font-body mb-2">
            Upcoming (estimated)
          </p>
          <div className="divide-y divide-gbx-border/60">
            {upcoming.map((e, i) => (
              <div key={e.ticker + e.exDate + i} className="flex items-center justify-between py-2 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-body text-gbx-charcoal truncate">
                    <span className="font-medium">{e.ticker}</span>
                    <span className="text-gbx-muted"> · {exLabel(e.exDate)}</span>
                  </p>
                  <p className="text-[11px] text-gbx-muted font-body truncate">
                    {e.units.toLocaleString("en-AU", { maximumFractionDigits: 2 })} × {fmt2(e.perUnit)}
                  </p>
                </div>
                <p className="font-data text-sm text-gbx-charcoal whitespace-nowrap">{fmt0(e.amount)}</p>
              </div>
            ))}
          </div>
          {data.events.length > 6 && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="text-[11px] text-gbx-teal uppercase tracking-[0.1em] font-body font-medium hover:text-gbx-deep-teal transition-colors pt-3"
            >
              {showAll ? "Show less" : `Show all ${data.events.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
