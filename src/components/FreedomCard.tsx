"use client";

import { useEffect, useState, useCallback } from "react";

interface Freedom {
  configured: boolean;
  reason?: string;
  settings: {
    swr: number;
    realReturn: number;
    annualSpend: number | null;
    targetOverride: number | null;
    includeHome: boolean;
    currentAge: number | null;
    birthP1: string | null;
    birthP2: string | null;
    retireAge: number;
  };
  netWorth: number;
  homeEquity: number;
  investedNow: number;
  annualSpend: number | null;
  spendDerived: boolean;
  annualIncome: number | null;
  annualSavings: number | null;
  fireTarget: number | null;
  targetFixed: boolean;
  sustainableSpend: number | null;
  progressPct: number | null;
  yearsToFire: number | null;
  fireDate: string | null;
  fireAge: number | null;
  ageP1: number | null;
  ageP2: number | null;
  coastNumber: number | null;
  coastReached: boolean | null;
  coastProgressPct: number | null;
}

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";
const labelClass =
  "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    month: "short",
    year: "numeric",
  });
}

function fmtYears(y: number): string {
  if (y < 1) return `${Math.round(y * 12)} months`;
  return `${y.toFixed(1)} years`;
}

export default function FreedomCard() {
  const [data, setData] = useState<Freedom | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState({ person1: "Person 1", person2: "Person 2" });
  const [form, setForm] = useState({
    swr: "",
    realReturn: "",
    annualSpend: "",
    targetOverride: "",
    includeHome: false,
    birthP1: "",
    birthP2: "",
    retireAge: "",
  });

  const load = useCallback(() => {
    fetch("/api/freedom")
      .then((r) => r.json())
      .then((d: Freedom) => {
        setData(d);
        setForm({
          swr: String(d.settings.swr),
          realReturn: String(d.settings.realReturn),
          annualSpend: d.settings.annualSpend != null ? String(d.settings.annualSpend) : "",
          targetOverride: d.settings.targetOverride != null ? String(d.settings.targetOverride) : "",
          includeHome: d.settings.includeHome,
          birthP1: d.settings.birthP1 || "",
          birthP2: d.settings.birthP2 || "",
          retireAge: String(d.settings.retireAge),
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => {});
  }, [load]);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/freedom", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        swr: form.swr,
        realReturn: form.realReturn,
        annualSpend: form.annualSpend,
        targetOverride: form.targetOverride,
        includeHome: form.includeHome,
        birthP1: form.birthP1,
        birthP2: form.birthP2,
        retireAge: form.retireAge,
      }),
    });
    const d = await res.json();
    setData(d);
    setSaving(false);
    setEditing(false);
  }

  if (loading) {
    return (
      <div className="bg-gbx-charcoal border border-white/5 p-6">
        <p className="text-white/40 font-body text-sm">Loading freedom number…</p>
      </div>
    );
  }
  if (!data) return null;

  const pct = data.progressPct != null ? Math.max(0, Math.min(100, data.progressPct)) : 0;

  return (
    <div className="bg-gbx-charcoal border border-white/5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] font-body font-medium text-gbx-teal">
            Freedom Number
          </h2>
          <p className="text-[11px] text-white/40 font-body mt-1">
            {data.targetFixed && data.fireTarget != null
              ? `Fixed target ${fmt0(data.fireTarget)}`
              : `Independence at ${data.settings.swr}% withdrawal`}{" "}
            · {data.settings.realReturn}% real return
            {data.settings.includeHome ? " · incl. property" : ""}
          </p>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          className="text-[10px] uppercase tracking-[0.12em] text-white/40 hover:text-gbx-teal font-body transition-colors shrink-0"
        >
          {editing ? "Close" : "Assumptions"}
        </button>
      </div>

      {editing && (
        <div className="bg-white/5 border border-white/10 p-4 mb-5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className={`${labelClass} text-white/50`}>Fixed target $ (blank = from spend)</label>
              <input className={inputClass} value={form.targetOverride} onChange={(e) => setForm({ ...form, targetOverride: e.target.value })} placeholder="e.g. 2500000" />
            </div>
            <div>
              <label className={`${labelClass} text-white/50`}>Withdrawal rate %</label>
              <input className={inputClass} value={form.swr} onChange={(e) => setForm({ ...form, swr: e.target.value })} placeholder="4" />
            </div>
            <div>
              <label className={`${labelClass} text-white/50`}>Real return %</label>
              <input className={inputClass} value={form.realReturn} onChange={(e) => setForm({ ...form, realReturn: e.target.value })} placeholder="5" />
            </div>
            <div>
              <label className={`${labelClass} text-white/50`}>Annual spend (blank = auto)</label>
              <input className={inputClass} value={form.annualSpend} onChange={(e) => setForm({ ...form, annualSpend: e.target.value })} placeholder="auto from spending" />
            </div>
            <div>
              <label className={`${labelClass} text-white/50`}>{users.person1} birth month</label>
              <input type="month" className={inputClass} value={form.birthP1} onChange={(e) => setForm({ ...form, birthP1: e.target.value })} />
            </div>
            <div>
              <label className={`${labelClass} text-white/50`}>{users.person2} birth month</label>
              <input type="month" className={inputClass} value={form.birthP2} onChange={(e) => setForm({ ...form, birthP2: e.target.value })} />
            </div>
            <div>
              <label className={`${labelClass} text-white/50`}>Target retirement age</label>
              <input className={inputClass} value={form.retireAge} onChange={(e) => setForm({ ...form, retireAge: e.target.value })} placeholder="60" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-white/60 font-body">
                <input type="checkbox" checked={form.includeHome} onChange={(e) => setForm({ ...form, includeHome: e.target.checked })} />
                Count home equity
              </label>
            </div>
          </div>
          <button onClick={save} disabled={saving} className="bg-gbx-teal text-white px-4 py-2 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Save assumptions"}
          </button>
        </div>
      )}

      {!data.configured ? (
        <div className="text-white/60 font-body text-sm">
          <p>
            Add some spending (Import or the Spending tab) or set an annual spend in
            Assumptions, and this will show your path to financial independence.
          </p>
        </div>
      ) : (
        <>
          {/* Hero: progress to freedom */}
          <div className="flex items-end justify-between gap-4 mb-2">
            <div>
              <p className="font-heading text-4xl sm:text-5xl font-light text-white tabular-nums">
                {data.progressPct != null ? data.progressPct.toFixed(1) : "—"}
                <span className="text-2xl text-white/50">%</span>
              </p>
              <p className="text-[11px] uppercase tracking-[0.15em] text-white/40 font-body mt-1">
                of the way to freedom
              </p>
            </div>
            <div className="text-right">
              <p className="font-data text-lg text-white">{fmt0(data.investedNow)}</p>
              <p className="text-[11px] text-white/40 font-body">
                of {data.fireTarget != null ? fmt0(data.fireTarget) : "—"} target
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2.5 bg-white/10 rounded-sm overflow-hidden mb-5">
            <div className="h-full bg-gbx-teal transition-all" style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>

          {/* Milestones */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-body">
                Work-optional in
              </p>
              {data.yearsToFire != null ? (
                <>
                  <p className="font-data text-lg text-gbx-teal mt-0.5">{fmtYears(data.yearsToFire)}</p>
                  <p className="text-[11px] text-white/40 font-body">
                    ~{data.fireDate ? fmtDate(data.fireDate) : "—"}
                    {data.fireAge != null ? ` · age ${data.fireAge}` : ""}
                  </p>
                </>
              ) : (
                <p className="font-data text-sm text-white/50 mt-0.5">
                  Not reachable at the current savings rate
                </p>
              )}
            </div>
            <div className="bg-white/5 border border-white/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-body">
                Coast FIRE
              </p>
              {data.coastNumber == null ? (
                <p className="font-data text-sm text-white/50 mt-0.5">Set your age to unlock</p>
              ) : data.coastReached ? (
                <>
                  <p className="font-data text-lg text-gbx-teal mt-0.5">Reached ✓</p>
                  <p className="text-[11px] text-white/40 font-body">
                    You could stop contributing and still hit target by {data.settings.retireAge}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-data text-lg text-white mt-0.5">
                    {data.coastProgressPct != null ? data.coastProgressPct.toFixed(0) : "—"}%
                  </p>
                  <p className="text-[11px] text-white/40 font-body">
                    of {data.coastNumber != null ? fmt0(data.coastNumber) : "—"} to coast to {data.settings.retireAge}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Ages */}
          {(data.ageP1 != null || data.ageP2 != null) && (
            <p className="text-[11px] text-white/40 font-body mt-3">
              {data.ageP1 != null ? `${users.person1} ${Math.floor(data.ageP1)}` : ""}
              {data.ageP1 != null && data.ageP2 != null ? " · " : ""}
              {data.ageP2 != null ? `${users.person2} ${Math.floor(data.ageP2)}` : ""}
              {" · Coast measured to age "}
              {data.settings.retireAge} (whoever gets there first)
            </p>
          )}

          {/* Footnote: inputs */}
          <p className="text-[11px] text-white/30 font-body mt-1">
            {data.targetFixed && data.sustainableSpend != null
              ? `Supports ~${fmt0(data.sustainableSpend)}/yr at ${data.settings.swr}%`
              : `Spend ${data.annualSpend != null ? fmt0(data.annualSpend) : "—"}/yr${data.spendDerived ? " (auto)" : " (set)"}`}
            {data.annualSavings != null
              ? ` · saving ${fmt0(data.annualSavings)}/yr`
              : " · savings unknown (add income)"}
            {data.settings.includeHome
              ? " · incl. property"
              : data.homeEquity !== 0
                ? " · home equity excluded"
                : ""}
          </p>
        </>
      )}
    </div>
  );
}
