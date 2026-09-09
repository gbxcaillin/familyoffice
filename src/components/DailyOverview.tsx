"use client";

import { useEffect, useState, useCallback } from "react";
import InfoTip from "./InfoTip";

interface HoldingMover {
  ticker: string;
  name: string;
  units: number;
  price: number;
  value: number;
  ret: number;
  isCrypto: boolean;
}
interface EtfMover {
  ticker: string;
  name: string;
  price: number;
  changePercent: number;
  currency: string;
}
interface Overview {
  requestedDate: string;
  asOf: string | null;
  holdings: HoldingMover[];
  etfs: EtfMover[];
}

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);

function Pct({ v }: { v: number }) {
  const up = v >= 0;
  return (
    <span className={`font-data text-sm ${up ? "text-gbx-teal" : "text-red-500"}`}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(2)}%
    </span>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [excludeCrypto, setExcludeCrypto] = useState(false);

  // Remember the exclude-crypto choice per browser.
  useEffect(() => {
    try {
      setExcludeCrypto(localStorage.getItem("overviewExcludeCrypto") === "1");
    } catch {
      // ignore
    }
  }, []);
  function toggleCrypto(next: boolean) {
    setExcludeCrypto(next);
    try {
      localStorage.setItem("overviewExcludeCrypto", next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  const load = useCallback((d: string) => {
    setLoading(true);
    const q = d && d !== todayISO() ? `?date=${d}` : "";
    fetch(`/api/overview${q}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const filteredHoldings = (data?.holdings ?? []).filter(
    (h) => !excludeCrypto || !h.isCrypto
  );
  const topHoldings = filteredHoldings.slice(0, 5);
  const topEtfs = data?.etfs.slice(0, 5) ?? [];
  const hasCrypto = (data?.holdings ?? []).some((h) => h.isCrypto);

  return (
    <div className="bg-white border border-gbx-border p-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal flex items-center gap-1.5">
          Daily Overview
          <InfoTip label="Daily Overview">
            <p className="mb-2">
              <strong>Your top movers</strong> are your five best-performing holdings for the chosen
              day (one-day price change vs the previous trading day). Pick any past date with the
              selector.
            </p>
            <p>
              <strong>Top ETFs</strong> ranks a watchlist of major AU &amp; global ETFs by today&apos;s
              move (live from Yahoo) — market ideas for context, not advice.
            </p>
          </InfoTip>
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body">
            Day
          </label>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className="bg-white border border-gbx-border px-2 py-1 text-xs font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-gbx-muted font-body text-sm">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Our top holdings that day */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[10px] uppercase tracking-[0.15em] text-gbx-muted font-body">
                Your top movers{data?.asOf ? ` · ${data.asOf}` : ""}
              </p>
              {hasCrypto && (
                <label className="flex items-center gap-1.5 text-[10px] text-gbx-muted font-body cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={excludeCrypto}
                    onChange={(e) => toggleCrypto(e.target.checked)}
                  />
                  Exclude crypto
                </label>
              )}
            </div>
            {topHoldings.length === 0 ? (
              <p className="text-sm text-gbx-muted font-body">
                No holding price moves for this day.
              </p>
            ) : (
              <div className="divide-y divide-gbx-border/60">
                {topHoldings.map((h, i) => (
                  <div key={h.ticker + i} className="flex items-center justify-between py-2 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-body text-gbx-charcoal truncate">
                        <span className="font-medium">{h.ticker}</span>
                        <span className="text-gbx-muted"> · {fmt0(h.value)}</span>
                      </p>
                      <p className="text-[11px] text-gbx-muted font-body truncate">{h.name}</p>
                    </div>
                    <Pct v={h.ret} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Market: top ETF movers today */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-gbx-muted font-body mb-2">
              Top ETFs today · market
            </p>
            {topEtfs.length === 0 ? (
              <p className="text-sm text-gbx-muted font-body">
                Market data unavailable right now.
              </p>
            ) : (
              <div className="divide-y divide-gbx-border/60">
                {topEtfs.map((e, i) => (
                  <div key={e.ticker + i} className="flex items-center justify-between py-2 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-body text-gbx-charcoal truncate">
                        <span className="font-medium">{e.ticker}</span>
                        <span className="text-gbx-muted"> · {fmt0(e.price)}</span>
                      </p>
                      <p className="text-[11px] text-gbx-muted font-body truncate">{e.name}</p>
                    </div>
                    <Pct v={e.changePercent} />
                  </div>
                ))}
                <p className="text-[10px] text-gbx-muted font-body pt-2">
                  From a watchlist of major AU &amp; global ETFs, ranked by today&apos;s move (Yahoo). Not advice.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
