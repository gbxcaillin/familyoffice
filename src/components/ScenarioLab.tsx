"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// Baseline from /api/freedom used to seed the scenario.
interface Baseline {
  investedNow: number;
  annualSpend: number | null;
  annualSavings: number | null;
  effectiveReturn: number;
  fireTarget: number | null;
  effectiveAge: number | null;
  settings: { swr: number; targetOverride: number | null; retireAge: number; includeHome: boolean };
}

interface Scenario {
  startInvested: number;
  currentAge: number;
  accReturn: number; // % real, accumulation
  retReturn: number; // % real, in retirement
  savings: number; // annual, during accumulation
  extra: number; // extra annual contribution
  spend: number; // annual drawdown in retirement
  swr: number; // %
  target: number | null; // fixed target; null → derive from spend/swr
  retireAge: number;
  longevity: number; // plan-to age
}

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);
function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors tabular-nums";
const labelClass =
  "block text-[10px] uppercase tracking-[0.14em] font-body font-medium text-gbx-muted mb-1";

// One slider row with a live value read-out.
function Slider({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className={labelClass + " mb-0"}>{label}</label>
        <span className="font-data text-sm text-gbx-charcoal tabular-nums">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-gbx-teal"
      />
    </div>
  );
}

function projectScenario(sc: Scenario) {
  const target = sc.target && sc.target > 0 ? sc.target : sc.spend > 0 ? sc.spend * (100 / sc.swr) : 0;
  const accR = sc.accReturn / 100;
  const retR = sc.retReturn / 100;
  const startAge = Math.floor(sc.currentAge);
  const points: { age: number; value: number; phase: "acc" | "draw" }[] = [];
  let invested = sc.startInvested;
  let fireAge: number | null = null;
  let depletionAge: number | null = null;
  let potAtRetirement: number | null = null;

  for (let age = startAge; age <= sc.longevity; age++) {
    const phase: "acc" | "draw" = age < sc.retireAge ? "acc" : "draw";
    points.push({ age, value: Math.max(0, Math.round(invested)), phase });
    if (fireAge == null && target > 0 && invested >= target) fireAge = age;
    if (age === Math.floor(sc.retireAge)) potAtRetirement = invested;
    // Advance one year.
    if (phase === "acc") {
      invested = invested * (1 + accR) + sc.savings + sc.extra;
    } else {
      invested = invested * (1 + retR) - sc.spend;
      if (invested <= 0 && depletionAge == null) {
        depletionAge = age + 1;
        invested = 0;
      }
    }
  }

  const yearsToFire = fireAge != null ? fireAge - sc.currentAge : null;
  const progressPct = target > 0 ? (sc.startInvested / target) * 100 : null;
  // Coast: amount today that grows to target by retirement with no contributions.
  const yrsToRet = Math.max(0, sc.retireAge - sc.currentAge);
  const coastNumber = target > 0 ? target / Math.pow(1 + accR, yrsToRet) : null;
  const coastReached = coastNumber != null ? sc.startInvested >= coastNumber : null;

  return {
    target, points, fireAge, yearsToFire, progressPct,
    potAtRetirement, depletionAge, coastNumber, coastReached,
    endValue: points.length ? points[points.length - 1].value : 0,
  };
}

export default function ScenarioLab() {
  const [base, setBase] = useState<Baseline | null>(null);
  const [sc, setSc] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  function seedFrom(b: Baseline): Scenario {
    const spend = b.annualSpend ?? 80000;
    return {
      startInvested: Math.round(b.investedNow),
      currentAge: b.effectiveAge != null ? Math.round(b.effectiveAge) : 40,
      accReturn: b.effectiveReturn,
      retReturn: Math.max(2, b.effectiveReturn - 1), // gentler in drawdown by default
      savings: Math.max(0, Math.round(b.annualSavings ?? 0)),
      extra: 0,
      spend: Math.round(spend),
      swr: b.settings.swr,
      target: b.settings.targetOverride,
      retireAge: b.settings.retireAge,
      longevity: 95,
    };
  }

  useEffect(() => {
    fetch("/api/freedom")
      .then((r) => r.json())
      .then((b: Baseline) => {
        setBase(b);
        setSc(seedFrom(b));
      })
      .finally(() => setLoading(false));
  }, []);

  const result = useMemo(() => (sc ? projectScenario(sc) : null), [sc]);

  if (loading || !sc || !base || !result) {
    return (
      <div className="bg-white border border-gbx-border p-6">
        <p className="text-gbx-muted font-body text-sm">Loading scenario…</p>
      </div>
    );
  }

  const set = (patch: Partial<Scenario>) => setSc({ ...sc, ...patch });
  const dirty = JSON.stringify(sc) !== JSON.stringify(seedFrom(base));

  async function saveAsPlan() {
    if (!sc) return;
    setSaving(true);
    setSavedMsg("");
    try {
      await Promise.all([
        fetch("/api/freedom", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ swr: sc.swr, targetOverride: sc.target ?? "", retireAge: sc.retireAge }),
        }),
        fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ desiredReturn: sc.accReturn, annualSpend: sc.spend }),
        }),
      ]);
      setSavedMsg("Saved to your plan — the Freedom card now uses these.");
    } catch {
      setSavedMsg("Couldn't save — try again.");
    }
    setSaving(false);
  }

  const outcomeTiles: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "FIRE target", value: fmt0(result.target) },
    {
      label: "Work-optional at",
      value: result.fireAge != null ? `age ${result.fireAge} (${result.yearsToFire!.toFixed(0)} yr)` : "not reached",
      tone: result.fireAge != null ? "good" : "bad",
    },
    {
      label: "Coast FIRE",
      value: result.coastReached == null ? "—" : result.coastReached ? "reached ✓" : `${fmt0(result.coastNumber!)} needed`,
      tone: result.coastReached ? "good" : undefined,
    },
    {
      label: `Pot at age ${sc.retireAge}`,
      value: result.potAtRetirement != null ? fmt0(result.potAtRetirement) : "—",
    },
    {
      label: "Money lasts",
      value: result.depletionAge == null ? `past age ${sc.longevity} ✓` : `until age ${result.depletionAge}`,
      tone: result.depletionAge == null ? "good" : "bad",
    },
    { label: `Left at age ${sc.longevity}`, value: fmt0(result.endValue), tone: result.endValue > 0 ? "good" : "bad" },
  ];

  return (
    <div className="bg-white border border-gbx-border p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
          Scenario Lab
        </h2>
        <div className="flex items-center gap-3">
          {dirty && (
            <button onClick={() => setSc(seedFrom(base))} className="text-[11px] text-gbx-muted hover:text-gbx-charcoal uppercase tracking-[0.12em] font-body transition-colors">
              Reset to plan
            </button>
          )}
          <button onClick={saveAsPlan} disabled={saving} className="bg-gbx-teal text-white px-4 py-2 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Save as my plan"}
          </button>
        </div>
      </div>
      <p className="text-xs text-gbx-muted font-body -mt-3">
        Everything here is a live &ldquo;what-if&rdquo; — nothing is saved unless you press Save. All figures are in
        today&apos;s dollars (real terms).
      </p>

      {/* Outcomes */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {outcomeTiles.map((t) => (
          <div key={t.label} className="bg-gbx-soft p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body">{t.label}</p>
            <p className={`font-data text-base mt-0.5 ${t.tone === "good" ? "text-gbx-teal" : t.tone === "bad" ? "text-red-500" : "text-gbx-charcoal"}`}>
              {t.value}
            </p>
          </div>
        ))}
      </div>

      {/* Projection chart */}
      <div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={result.points} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="scFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2E8B6E" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2E8B6E" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e3da" vertical={false} />
            <XAxis dataKey="age" tick={{ fontSize: 11, fill: "#8a8578" }} tickLine={false} axisLine={{ stroke: "#e7e3da" }} />
            <YAxis tickFormatter={fmtCompact} width={48} tick={{ fontSize: 11, fill: "#8a8578" }} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(v) => [fmt0(Number(v)), "Balance"] as [string, string]}
              labelFormatter={(a) => `Age ${a}`}
              contentStyle={{ fontSize: 12, fontFamily: "monospace", border: "1px solid #e7e3da" }}
            />
            {result.target > 0 && (
              <ReferenceLine y={result.target} stroke="#C68A2E" strokeDasharray="4 4" label={{ value: "target", position: "insideTopRight", fontSize: 10, fill: "#C68A2E" }} />
            )}
            <ReferenceLine x={Math.floor(sc.retireAge)} stroke="#8a8578" strokeDasharray="2 2" label={{ value: "retire", position: "top", fontSize: 10, fill: "#8a8578" }} />
            <Area type="monotone" dataKey="value" stroke="#2E8B6E" strokeWidth={2} fill="url(#scFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <Slider label="Expected return (accumulation)" value={sc.accReturn} min={0} max={12} step={0.5} onChange={(v) => set({ accReturn: v })} fmt={(v) => `${v.toFixed(1)}%`} />
        <Slider label="Return in retirement" value={sc.retReturn} min={0} max={12} step={0.5} onChange={(v) => set({ retReturn: v })} fmt={(v) => `${v.toFixed(1)}%`} />
        <Slider label="Withdrawal rate" value={sc.swr} min={2} max={8} step={0.1} onChange={(v) => set({ swr: v })} fmt={(v) => `${v.toFixed(1)}%`} />
        <Slider label="Retirement age" value={sc.retireAge} min={Math.ceil(sc.currentAge)} max={75} step={1} onChange={(v) => set({ retireAge: v })} fmt={(v) => `${v}`} />
        <Slider label="Annual saving (now → retirement)" value={sc.savings} min={0} max={250000} step={1000} onChange={(v) => set({ savings: v })} fmt={fmtCompact} />
        <Slider label="Annual spend in retirement" value={sc.spend} min={20000} max={300000} step={1000} onChange={(v) => set({ spend: v })} fmt={fmtCompact} />
        <Slider label="Extra one-off contribution / yr" value={sc.extra} min={0} max={100000} step={500} onChange={(v) => set({ extra: v })} fmt={fmtCompact} />
        <Slider label="Plan to age" value={sc.longevity} min={80} max={105} step={1} onChange={(v) => set({ longevity: v })} fmt={(v) => `${v}`} />

        <div>
          <label className={labelClass}>Starting invested</label>
          <input className={inputClass} type="number" value={sc.startInvested} onChange={(e) => set({ startInvested: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className={labelClass}>Current age</label>
          <input className={inputClass} type="number" value={sc.currentAge} onChange={(e) => set({ currentAge: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className={labelClass}>Fixed target (blank = spend ÷ withdrawal rate)</label>
          <input className={inputClass} type="number" value={sc.target ?? ""} placeholder={fmt0(sc.spend * (100 / sc.swr))} onChange={(e) => set({ target: e.target.value === "" ? null : parseFloat(e.target.value) })} />
        </div>
      </div>

      {savedMsg && <p className="text-[12px] text-gbx-teal font-body">{savedMsg}</p>}
    </div>
  );
}
