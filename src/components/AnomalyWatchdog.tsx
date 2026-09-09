"use client";

import { useEffect, useState } from "react";

type Severity = "alert" | "warn" | "info";
interface Anomaly {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

const STYLES: Record<Severity, { dot: string; label: string; ring: string }> = {
  alert: { dot: "bg-red-500", label: "text-red-600", ring: "border-red-300" },
  warn: { dot: "bg-amber-500", label: "text-amber-600", ring: "border-amber-300" },
  info: { dot: "bg-gbx-teal", label: "text-gbx-teal", ring: "border-gbx-border" },
};
const SEV_TEXT: Record<Severity, string> = {
  alert: "Alert",
  warn: "Warning",
  info: "Heads-up",
};

export default function AnomalyWatchdog() {
  const [items, setItems] = useState<Anomaly[] | null>(null);

  useEffect(() => {
    fetch("/api/anomalies")
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d?.anomalies) ? d.anomalies : []))
      .catch(() => setItems([]));
  }, []);

  if (items == null) return null; // don't flash while loading

  const alerts = items.filter((i) => i.severity === "alert").length;
  const warns = items.filter((i) => i.severity === "warn").length;

  return (
    <div className="bg-white border border-gbx-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
          Watchdog
        </h2>
        <span className="text-[11px] font-body text-gbx-muted">
          {items.length === 0
            ? "All clear"
            : `${alerts ? `${alerts} alert${alerts > 1 ? "s" : ""}` : ""}${
                alerts && warns ? " · " : ""
              }${warns ? `${warns} warning${warns > 1 ? "s" : ""}` : ""}${
                !alerts && !warns ? `${items.length} note${items.length > 1 ? "s" : ""}` : ""
              }`}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm font-body text-gbx-muted">
          <span className="w-2 h-2 rounded-full bg-gbx-teal inline-block" />
          Everything looks healthy — no data glitches, stale feeds or drifted anchors detected.
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((a) => {
            const st = STYLES[a.severity];
            return (
              <div key={a.id} className={`flex gap-3 border ${st.ring} p-3`}>
                <span className={`w-2 h-2 rounded-full ${st.dot} mt-1.5 shrink-0`} />
                <div className="min-w-0">
                  <p className="text-sm font-body text-gbx-charcoal">
                    <span className={`text-[10px] uppercase tracking-[0.12em] font-medium ${st.label} mr-2`}>
                      {SEV_TEXT[a.severity]}
                    </span>
                    {a.title}
                  </p>
                  <p className="text-[12px] text-gbx-muted font-body mt-0.5">{a.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
