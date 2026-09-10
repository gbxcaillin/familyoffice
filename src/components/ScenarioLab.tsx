"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import InfoTip from "./InfoTip";

interface Mortgage {
  hasMortgage: boolean;
  propertyValue: number;
  loanBalance: number;
  rate: number;
  monthlyRepayment: number;
  annualRepayment: number;
}
interface Baseline {
  investedNow: number;
  netWorth: number;
  homeEquity: number;
  superBalance: number;
  annualSpend: number | null;
  annualSavings: number | null;
  annualIncome: number | null; // household take-home (after tax)
  discretionarySavings: number | null;
  superContribNet: number;
  effectiveNominal: number;
  inflation: number;
  effectiveAge: number | null;
  settings: { swr: number; targetOverride: number | null; retireAge: number; includeHome: boolean };
  mortgage: Mortgage;
}

type Strategy = "schedule" | "payoff_early" | "payoff_retire";

interface Scenario {
  startOutside: number; // investable outside super (accessible any time)
  startSuper: number; // super (locked until preservation age)
  netIncome: number; // household after-tax income / yr (for the feasibility check)
  currentAge: number;
  accReturn: number; // NOMINAL %
  retReturn: number; // NOMINAL %
  inflation: number; // %
  investWithin: number; // invested from WITHIN the spend budget (saved, not consumed)
  investExtra: number; // invested ON TOP of the spend budget (needs income above spend)
  superContrib: number; // annual net employer super into SUPER
  spend: number; // annual all-in spend, INCLUDING mortgage (drops when loan clears)
  swr: number;
  target: number | null;
  retireAge: number;
  preservationAge: number; // super accessible from here
  longevity: number;
  includeHomeInTarget: boolean;
  propertyValue: number;
  propGrowth: number; // % real
  loanBalance: number;
  loanRate: number; // annual %
  annualRepayment: number;
  extraMonthly: number; // additional monthly repayment (drives "pay off early")
  strategy: Strategy;
}

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);
function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}
function realFromNominal(nom: number, infl: number): number {
  return ((1 + nom / 100) / (1 + infl / 100) - 1) * 100;
}

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors tabular-nums";
const labelClass =
  "block text-[10px] uppercase tracking-[0.14em] font-body font-medium text-gbx-muted mb-1";

function Slider({
  label, value, min, max, step, onChange, suffix, money, info,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix?: string; money?: boolean; info?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1 gap-2">
        <label className={labelClass + " mb-0 flex items-center gap-1.5"}>
          {label}
          {info && <InfoTip label={label}>{info}</InfoTip>}
        </label>
        <span className="flex items-center gap-1 shrink-0">
          {money && <span className="text-sm text-gbx-muted font-data">$</span>}
          <input
            type="number" inputMode="decimal" value={value === 0 ? "" : value} step={step} placeholder="0"
            onChange={(e) => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))}
            className="w-24 text-right bg-white border border-gbx-border px-2 py-1 text-sm font-data text-gbx-charcoal tabular-nums focus:outline-none focus:border-gbx-teal"
          />
          {suffix && <span className="text-sm text-gbx-muted font-data">{suffix}</span>}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-gbx-teal"
      />
    </div>
  );
}

interface ProjResult {
  target: number;
  points: { age: number; outside: number; super: number; home: number; netWorth: number }[];
  fireAge: number | null;
  yearsToFire: number | null;
  outsideAtRetire: number | null;
  superAtRetire: number | null;
  propertyAtRetire: number | null;
  propertyEnd: number;
  bridgeFailAge: number | null; // outside super ran out before preservation age
  depletionAge: number | null; // all accessible funds exhausted
  mortgageClearAge: number | null;
  endNetWorth: number;
  endLiquid: number;
}

// Two-pool projection. OUTSIDE super is accessible any time; SUPER is locked
// until the preservation age. Before then, retirement spending (and any
// mortgage) must come from outside super — the "bridge". After preservation the
// two pools combine. Everything in today's dollars (real).
function projectScenario(sc: Scenario, strategy: Strategy): ProjResult {
  const target =
    sc.target && sc.target > 0 ? sc.target : sc.spend > 0 ? sc.spend * (100 / sc.swr) : 0;
  const accR = realFromNominal(sc.accReturn, sc.inflation) / 100;
  const retR = realFromNominal(sc.retReturn, sc.inflation) / 100;
  const propG = sc.propGrowth / 100;
  const mRate = sc.loanRate / 100 / 12;
  const monthlyRep = sc.annualRepayment / 12;
  const startAge = Math.floor(sc.currentAge);
  const preservation = sc.preservationAge;

  let out = sc.startOutside;
  let sup = sc.startSuper;
  let loan = sc.loanBalance;
  let prop = sc.propertyValue;
  let fireAge: number | null = null;
  let bridgeFailAge: number | null = null;
  let depletionAge: number | null = null;
  let outsideAtRetire: number | null = null;
  let superAtRetire: number | null = null;
  let propertyAtRetire: number | null = null;
  let mortgageClearAge: number | null = loan <= 0 ? startAge : null;

  const points: ProjResult["points"] = [];

  for (let age = startAge; age <= sc.longevity; age++) {
    const homeEquity = prop - loan;
    const netWorth = out + sup + homeEquity;
    points.push({
      age,
      outside: Math.round(Math.max(0, out)),
      super: Math.round(Math.max(0, sup)),
      home: Math.round(Math.max(0, homeEquity)),
      netWorth: Math.round(netWorth),
    });

    const metric = sc.includeHomeInTarget ? netWorth : out + sup;
    if (fireAge == null && target > 0 && metric >= target) fireAge = age;
    if (age === Math.floor(sc.retireAge)) {
      outsideAtRetire = out;
      superAtRetire = sup;
      propertyAtRetire = homeEquity;
    }

    // Pay off at retirement — from outside first, then super if already unlocked.
    if (strategy === "payoff_retire" && age === Math.floor(sc.retireAge) && loan > 0) {
      let need = loan;
      const fo = Math.min(out, need);
      out -= fo; need -= fo; loan -= fo;
      if (age >= preservation && need > 0) {
        const fs = Math.min(sup, need);
        sup -= fs; need -= fs; loan -= fs;
      }
      if (loan <= 0 && mortgageClearAge == null) mortgageClearAge = age;
    }

    const active = loan > 0;
    const working = age < sc.retireAge;
    // "Pay off early" adds extra repayments while working, clearing the loan
    // sooner. The extra is money diverted from investing, so it's subtracted
    // from the outside-super contribution below.
    const extraMonthlyThisYear =
      strategy === "payoff_early" && working && active ? Math.max(0, sc.extraMonthly) : 0;
    const monthlyPay = monthlyRep + extraMonthlyThisYear;
    for (let m = 0; m < 12 && loan > 0; m++) {
      const interest = loan * mRate;
      let pay = monthlyPay;
      if (pay > loan + interest) pay = loan + interest;
      loan = loan + interest - pay;
      if (loan < 0) loan = 0;
    }
    if (active && loan <= 0 && mortgageClearAge == null) mortgageClearAge = age;

    if (working) {
      // Working: discretionary → outside (less any extra repayments diverted to
      // the mortgage); employer super → super. Once the loan clears, the base
      // repayment frees up back into investing.
      out = out * (1 + accR) + (sc.investWithin + sc.investExtra) - extraMonthlyThisYear * 12 + (active ? 0 : sc.annualRepayment);
      sup = sup * (1 + accR) + sc.superContrib;
    } else {
      // Spend INCLUDES the mortgage and the within-budget investing, neither of
      // which continues in retirement — so the actual drawdown is spend minus the
      // within-budget investing, and minus the mortgage once the loan clears.
      const draw = Math.max(0, sc.spend - sc.investWithin - (active ? 0 : sc.annualRepayment));
      if (age < preservation) {
        // Bridge years: only outside super is available.
        out = out * (1 + retR) - draw;
        sup = sup * (1 + retR);
        if (out <= 0) {
          if (bridgeFailAge == null) bridgeFailAge = age + 1;
          out = 0;
        }
      } else {
        // Super unlocked: draw from outside first, then super.
        out = out * (1 + retR);
        sup = sup * (1 + retR);
        let need = draw;
        const fo = Math.min(out, need); out -= fo; need -= fo;
        if (need > 0) { const fs = Math.min(sup, need); sup -= fs; need -= fs; }
        if (need > 0 && depletionAge == null) depletionAge = age + 1;
      }
    }
    if (age >= preservation && out + sup <= 0 && depletionAge == null) depletionAge = age + 1;
    prop = prop * (1 + propG);
  }

  const yearsToFire = fireAge != null ? fireAge - sc.currentAge : null;
  const last = points[points.length - 1];
  return {
    target,
    points,
    fireAge,
    yearsToFire,
    outsideAtRetire,
    superAtRetire,
    propertyAtRetire,
    propertyEnd: last ? last.home : 0,
    bridgeFailAge,
    depletionAge,
    mortgageClearAge,
    endNetWorth: last ? last.netWorth : 0,
    endLiquid: last ? last.outside + last.super : 0,
  };
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  schedule: "Pay on schedule",
  payoff_early: "Pay off early",
  payoff_retire: "Pay off at retirement",
};

export default function ScenarioLab() {
  const [base, setBase] = useState<Baseline | null>(null);
  const [sc, setSc] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  function seedFrom(b: Baseline): Scenario {
    const spend = b.annualSpend ?? 80000;
    const homeEquity = b.mortgage.propertyValue - b.mortgage.loanBalance;
    const totalLiquid = b.netWorth - homeEquity;
    const startSuper = Math.round(Math.max(0, b.superBalance));
    const startOutside = Math.round(Math.max(0, totalLiquid - startSuper));
    const nominal = b.effectiveNominal || 7.5;
    return {
      startOutside,
      startSuper,
      netIncome: Math.max(0, Math.round(b.annualIncome ?? 0)),
      currentAge: b.effectiveAge != null ? Math.round(b.effectiveAge) : 40,
      accReturn: nominal,
      retReturn: Math.max(3, nominal - 1),
      inflation: b.inflation ?? 2.5,
      investWithin: 0,
      investExtra: Math.max(0, Math.round(b.discretionarySavings ?? 0)),
      superContrib: Math.max(0, Math.round(b.superContribNet ?? 0)),
      spend: Math.round(spend),
      swr: b.settings.swr,
      target: b.settings.targetOverride,
      retireAge: b.settings.retireAge,
      preservationAge: 60,
      longevity: 95,
      includeHomeInTarget: b.settings.includeHome,
      propertyValue: Math.round(b.mortgage.propertyValue),
      propGrowth: 0,
      loanBalance: Math.round(b.mortgage.loanBalance),
      loanRate: b.mortgage.rate || 6,
      annualRepayment: Math.round(b.mortgage.annualRepayment),
      extraMonthly: 0,
      strategy: "schedule",
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

  const result = useMemo(() => (sc ? projectScenario(sc, sc.strategy) : null), [sc]);
  const comparison = useMemo(() => {
    if (!sc || !sc.loanBalance) return null;
    return (["schedule", "payoff_early", "payoff_retire"] as Strategy[]).map((s) => ({
      strategy: s,
      res: projectScenario(sc, s),
    }));
  }, [sc]);

  if (loading || !sc || !base || !result) {
    return (
      <div className="bg-white border border-gbx-border p-6">
        <p className="text-gbx-muted font-body text-sm">Loading scenario…</p>
      </div>
    );
  }

  const set = (patch: Partial<Scenario>) => setSc({ ...sc, ...patch });
  const dirty = JSON.stringify(sc) !== JSON.stringify(seedFrom(base));
  const hasMortgage = sc.loanBalance > 0;
  const needsBridge = sc.retireAge < sc.preservationAge;

  async function saveAsPlan() {
    if (!sc) return;
    setSaving(true);
    setSavedMsg("");
    try {
      await Promise.all([
        fetch("/api/freedom", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ swr: sc.swr, targetOverride: sc.target ?? "", retireAge: sc.retireAge, inflation: sc.inflation }),
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

  const bridgeValue = !needsBridge
    ? `n/a (retire ≥ ${sc.preservationAge})`
    : result.bridgeFailAge == null
      ? `covered to ${sc.preservationAge} ✓`
      : `short at age ${result.bridgeFailAge}`;

  const outcomeTiles: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "FIRE target", value: fmt0(result.target) },
    {
      label: "Work-optional at",
      value: result.fireAge != null ? `age ${result.fireAge} (${result.yearsToFire!.toFixed(0)} yr)` : "not reached",
      tone: result.fireAge != null ? "good" : "bad",
    },
    {
      label: `Bridge to ${sc.preservationAge}`,
      value: bridgeValue,
      tone: !needsBridge ? undefined : result.bridgeFailAge == null ? "good" : "bad",
    },
    { label: `Investments at ${sc.retireAge}`, value: result.outsideAtRetire != null ? fmt0(result.outsideAtRetire) : "—" },
    { label: `Super at ${sc.retireAge}`, value: result.superAtRetire != null ? fmt0(result.superAtRetire) : "—" },
    { label: `Property equity at ${sc.retireAge}`, value: result.propertyAtRetire != null ? fmt0(result.propertyAtRetire) : "—" },
    { label: `Property equity at ${sc.longevity}`, value: fmt0(result.propertyEnd) },
    {
      label: "Money lasts",
      value: result.depletionAge == null ? `past age ${sc.longevity} ✓` : `until age ${result.depletionAge}`,
      tone: result.depletionAge == null ? "good" : "bad",
    },
    {
      label: "Mortgage clear",
      value: !hasMortgage ? "already clear" : result.mortgageClearAge != null ? `age ${Math.round(result.mortgageClearAge)}` : `after ${sc.longevity}`,
    },
    { label: `Est. estate at ${sc.longevity} (today's $)`, value: fmt0(result.endNetWorth) },
  ];

  return (
    <div className="bg-white border border-gbx-border p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal flex items-center gap-1.5">
          Scenario Lab
          <InfoTip label="Scenario Lab">
            <p className="mb-2">
              A live &ldquo;what-if&rdquo; — nothing saves unless you press Save. All figures are in today&apos;s
              dollars (real terms).
            </p>
            <p className="mb-2">
              <strong>Outside super</strong> is accessible any time; <strong>super</strong> is locked until the
              preservation age (~60). If you retire earlier, your outside-super pool has to fund the years until
              then — the <strong>bridge</strong>. The tiles and chart show whether it covers it.
            </p>
            <p>Net worth = outside + super + home equity; &ldquo;money lasts&rdquo; is judged on the accessible pools.</p>
          </InfoTip>
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

      {/* Outcomes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {outcomeTiles.map((t) => (
          <div key={t.label} className="bg-gbx-soft p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body">{t.label}</p>
            <p className={`font-data text-sm mt-0.5 ${t.tone === "good" ? "text-gbx-teal" : t.tone === "bad" ? "text-red-500" : "text-gbx-charcoal"}`}>
              {t.value}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gbx-muted font-body -mt-3">
        Returns entered <strong>nominal</strong>; at {sc.inflation}% inflation that&apos;s{" "}
        <span className="text-gbx-charcoal">{realFromNominal(sc.accReturn, sc.inflation).toFixed(1)}% real</span> /{" "}
        <span className="text-gbx-charcoal">{realFromNominal(sc.retReturn, sc.inflation).toFixed(1)}% real</span> in retirement.
        {needsBridge && result.bridgeFailAge != null
          ? " ⚠ Outside super runs out before super unlocks — raise savings, spend less, or retire later."
          : ""}
      </p>

      {/* Feasibility / cashflow check for the working years */}
      {(() => {
        const extraAnnual = sc.strategy === "payoff_early" && sc.loanBalance > 0 ? Math.max(0, sc.extraMonthly) * 12 : 0;
        // Spend includes the mortgage and any within-budget investing, so only
        // the on-top investing and extra repayments sit above spend.
        const outflow = sc.spend + extraAnnual + sc.investExtra;
        const surplus = sc.netIncome - outflow;
        const ok = surplus >= 0;
        const totalInvest = sc.investWithin + sc.investExtra;
        const row = (label: string, val: number, sign: "+" | "−") => (
          <div className="flex justify-between">
            <span className="text-gbx-muted">{label}</span>
            <span className="font-data tabular-nums text-gbx-charcoal">
              {sign === "−" ? "− " : ""}{fmt0(val)}
            </span>
          </div>
        );
        return (
          <div className={`border p-4 ${ok ? "border-gbx-border bg-gbx-soft" : "border-red-400/50 bg-red-500/5"}`}>
            <p className="text-[10px] uppercase tracking-[0.14em] font-body font-medium text-gbx-charcoal flex items-center gap-1.5 mb-3">
              Cashflow check — working years
              <InfoTip label="Cashflow check">
                <p className="mb-2">
                  Confirms the plan is actually fundable: your after-tax income must cover your
                  all-in spending (which <em>includes</em> the mortgage) plus any extra repayments and
                  the amount you invest each year — you can&apos;t invest money you don&apos;t have.
                </p>
                <p>Employer super is paid on top of salary, so it isn&apos;t counted here.</p>
              </InfoTip>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm font-body">
              {row("After-tax income", sc.netIncome, "+")}
              {row("Annual spend (incl. mortgage)", sc.spend, "−")}
              {extraAnnual > 0 && row("Extra mortgage repayment", extraAnnual, "−")}
              {sc.investExtra > 0 && row("Invested on top of spend", sc.investExtra, "−")}
            </div>
            <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-gbx-border/60">
              <span className={`text-sm font-body font-medium ${ok ? "text-gbx-teal" : "text-red-600"}`}>
                {ok ? "Fundable — surplus" : "Not fundable — shortfall"}
              </span>
              <span className={`font-data text-base ${ok ? "text-gbx-teal" : "text-red-600"}`}>
                {ok ? "" : "−"}{fmt0(Math.abs(surplus))}/yr
              </span>
            </div>
            <p className="text-[11px] text-gbx-muted font-body mt-2">
              Investing {fmt0(totalInvest)}/yr total — {fmt0(sc.investWithin)} from within the spend
              budget + {fmt0(sc.investExtra)} on top.
              {ok && surplus > 0
                ? ` ${fmt0(surplus)}/yr is still unspent — you could invest up to that much more on top.`
                : ""}
            </p>
            {!ok && (
              <p className="text-[12px] text-red-600 font-body mt-2">
                Your income can&apos;t cover this. Lower spending, invest less on top, reduce extra
                repayments, or increase income — the on-top investing isn&apos;t achievable as it stands.
              </p>
            )}
          </div>
        );
      })()}

      {/* Chart: stacked outside + super, with net worth line */}
      <div>
        <ResponsiveContainer width="100%" height={290}>
          <ComposedChart data={result.points} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e3da" vertical={false} />
            <XAxis dataKey="age" tick={{ fontSize: 11, fill: "#8a8578" }} tickLine={false} axisLine={{ stroke: "#e7e3da" }} />
            <YAxis tickFormatter={fmtCompact} width={48} tick={{ fontSize: 11, fill: "#8a8578" }} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(v, n) => [fmt0(Number(v)), n as string] as [string, string]}
              labelFormatter={(a) => `Age ${a}`}
              contentStyle={{ fontSize: 12, fontFamily: "monospace", border: "1px solid #e7e3da" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {result.target > 0 && (
              <ReferenceLine y={result.target} stroke="#C68A2E" strokeDasharray="4 4" label={{ value: "target", position: "insideTopRight", fontSize: 10, fill: "#C68A2E" }} />
            )}
            <ReferenceLine x={Math.floor(sc.retireAge)} stroke="#8a8578" strokeDasharray="2 2" label={{ value: "retire", position: "top", fontSize: 10, fill: "#8a8578" }} />
            {needsBridge && (
              <ReferenceLine x={sc.preservationAge} stroke="#2E8B6E" strokeDasharray="2 2" label={{ value: "super", position: "top", fontSize: 10, fill: "#2E8B6E" }} />
            )}
            {/* Stacked: Investments + Super + Property = net worth (the stack top) */}
            <Area type="monotone" dataKey="outside" stackId="1" name="Investments" stroke="#2E8B6E" strokeWidth={1.5} fill="#2E8B6E" fillOpacity={0.3} />
            <Area type="monotone" dataKey="super" stackId="1" name="Super" stroke="#C68A2E" strokeWidth={1.5} fill="#C68A2E" fillOpacity={0.3} />
            <Area type="monotone" dataKey="home" stackId="1" name="Property (equity)" stroke="#6E7B8B" strokeWidth={1.5} fill="#6E7B8B" fillOpacity={0.3} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Mortgage strategy */}
      {hasMortgage && (
        <div className="border border-gbx-border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] uppercase tracking-[0.14em] font-body font-medium text-gbx-charcoal flex items-center gap-1.5">
              Mortgage strategy
              <InfoTip label="Mortgage strategy">
                <p className="mb-2">
                  <strong>Pay on schedule</strong> keeps cash invested and pays the loan with its normal
                  repayments.
                </p>
                <p className="mb-2">
                  <strong>Pay off early</strong> adds the extra monthly repayment below — the loan clears
                  sooner and saves interest, but you invest less while paying it down.
                </p>
                <p className="mb-2">
                  <strong>Pay off at retirement</strong> clears whatever&apos;s left with a lump from your
                  outside-super assets at the retirement age.
                </p>
                <p>The table shows how each choice changes the bridge and how long the money lasts.</p>
              </InfoTip>
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((s) => (
                <button
                  key={s}
                  onClick={() => set({ strategy: s })}
                  className={`text-[11px] px-3 py-1.5 font-body border transition-colors ${
                    sc.strategy === s ? "border-gbx-teal text-gbx-teal bg-gbx-teal/5" : "border-gbx-border text-gbx-muted hover:text-gbx-charcoal"
                  }`}
                >
                  {STRATEGY_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {comparison && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-body">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.1em] text-gbx-muted">
                    <th className="text-left font-medium py-1.5">Strategy</th>
                    <th className="text-right font-medium">Bridge to {sc.preservationAge}</th>
                    <th className="text-right font-medium">Money lasts</th>
                    <th className="text-right font-medium">Mortgage clear</th>
                    <th className="text-right font-medium">Estate @ {sc.longevity}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gbx-border/60">
                  {comparison.map(({ strategy, res }) => (
                    <tr key={strategy} className={sc.strategy === strategy ? "bg-gbx-teal/5" : ""}>
                      <td className="py-2 text-gbx-charcoal">{STRATEGY_LABELS[strategy]}</td>
                      <td className={`text-right font-data ${!needsBridge ? "text-gbx-muted" : res.bridgeFailAge == null ? "text-gbx-teal" : "text-red-500"}`}>
                        {!needsBridge ? "n/a" : res.bridgeFailAge == null ? "ok" : `age ${res.bridgeFailAge}`}
                      </td>
                      <td className={`text-right font-data ${res.depletionAge == null ? "text-gbx-teal" : "text-red-500"}`}>
                        {res.depletionAge == null ? `past ${sc.longevity}` : `age ${res.depletionAge}`}
                      </td>
                      <td className="text-right font-data text-gbx-charcoal">
                        {res.mortgageClearAge != null ? `age ${Math.round(res.mortgageClearAge)}` : `>${sc.longevity}`}
                      </td>
                      <td className="text-right font-data text-gbx-charcoal">{fmt0(res.endNetWorth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 pt-1">
            <div>
              <label className={labelClass}>Loan balance</label>
              <input className={inputClass} type="number" inputMode="decimal" value={sc.loanBalance === 0 ? "" : sc.loanBalance} onChange={(e) => set({ loanBalance: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className={labelClass}>Annual repayment</label>
              <input className={inputClass} type="number" inputMode="decimal" value={sc.annualRepayment === 0 ? "" : sc.annualRepayment} onChange={(e) => set({ annualRepayment: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className={`${labelClass} flex items-center gap-1.5`}>
                Additional repayment / month
                <InfoTip label="Additional monthly repayment">
                  <p className="mb-2">
                    Extra paid on the mortgage each month, on top of the normal repayment. It clears
                    the loan sooner and saves interest — this is the &ldquo;pay off early&rdquo; lever.
                  </p>
                  <p>
                    The extra comes out of what you&apos;d otherwise invest outside super while
                    working; once the loan is gone, the freed repayment goes back to investing.
                    Setting this switches the strategy to Pay off early.
                  </p>
                </InfoTip>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gbx-muted font-data">$</span>
                <input
                  className={inputClass}
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={sc.extraMonthly === 0 ? "" : sc.extraMonthly}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
                    set({
                      extraMonthly: v,
                      strategy: v > 0 ? "payoff_early" : sc.strategy === "payoff_early" ? "schedule" : sc.strategy,
                    });
                  }}
                />
              </div>
            </div>
            <Slider label="Loan interest rate" value={sc.loanRate} min={0} max={12} step={0.1} onChange={(v) => set({ loanRate: v })} suffix="%"
              info="The mortgage's annual interest rate. Higher rates mean more of each repayment goes to interest, so the loan takes longer to clear and 'pay off early' saves more." />
            <div>
              <label className={labelClass}>Property value</label>
              <input className={inputClass} type="number" inputMode="decimal" value={sc.propertyValue === 0 ? "" : sc.propertyValue} onChange={(e) => set({ propertyValue: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })} />
            </div>
            <Slider label="Property growth (real)" value={sc.propGrowth} min={-2} max={6} step={0.5} onChange={(v) => set({ propGrowth: v })} suffix="%"
              info="Assumed home value growth per year above inflation (already real, so 0% means it just keeps pace with inflation). Affects home equity and net worth, not the liquid pools you actually spend." />
            <label className="flex items-end gap-2 text-xs text-gbx-muted font-body pb-2">
              <input type="checkbox" checked={sc.includeHomeInTarget} onChange={(e) => set({ includeHomeInTarget: e.target.checked })} />
              Count home equity toward target
            </label>
          </div>
        </div>
      )}

      {/* Core controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <Slider label="Expected return — nominal (accumulation)" value={sc.accReturn} min={0} max={15} step={0.5} onChange={(v) => set({ accReturn: v })} suffix="%"
          info="Your assumed investment return per year while still building wealth, before inflation. The engine subtracts inflation to get the real growth rate. Higher = the pot grows faster, so you reach the target sooner." />
        <Slider label="Return in retirement — nominal" value={sc.retReturn} min={0} max={15} step={0.5} onChange={(v) => set({ retReturn: v })} suffix="%"
          info="The return you assume once retired — usually set a touch lower than the accumulation figure, since portfolios are typically de-risked in retirement. Drives how long the money lasts while you're drawing it down." />
        <Slider label="Inflation" value={sc.inflation} min={0} max={8} step={0.1} onChange={(v) => set({ inflation: v })} suffix="%"
          info="Assumed annual inflation. It's subtracted from your nominal returns so everything is shown in today's dollars. Higher inflation means your nominal returns buy less, so real growth is lower." />
        <Slider label="Withdrawal rate" value={sc.swr} min={2} max={8} step={0.1} onChange={(v) => set({ swr: v })} suffix="%"
          info="The share of the pot you'd draw each year in retirement. 4% is the classic 'safe' rate (a pot ≈ 25× spend). When no fixed target is set, your FIRE target = annual spend ÷ this rate. Lower = safer but a bigger target." />
        <Slider label="Retirement age" value={sc.retireAge} min={Math.ceil(sc.currentAge)} max={75} step={1} onChange={(v) => set({ retireAge: v })}
          info="The age you stop working and start drawing down. Retiring before the preservation age means outside-super must fund the bridge years until super unlocks." />
        <Slider label="Super preservation age" value={sc.preservationAge} min={55} max={70} step={1} onChange={(v) => set({ preservationAge: v })}
          info="The age you can legally access super (60 for most people now). Before it, only outside-super money is available to spend — this is what creates the 'bridge'." />
        <Slider label="After-tax income / yr (household)" value={sc.netIncome} min={0} max={600000} step={1000} onChange={(v) => set({ netIncome: v })} money
          info="Your household take-home pay per year, after tax (auto-filled from your Profile salaries). Used for the cashflow check — spending + mortgage + investing must fit inside it. Employer super is on top and isn't counted here." />
        <Slider label="Invested within spend budget / yr" value={sc.investWithin} min={0} max={200000} step={1000} onChange={(v) => set({ investWithin: v })} money
          info="The slice of your annual spend that is actually invested rather than consumed (e.g. a regular contribution already inside your $200k budget). It's already covered by spend, so it doesn't reduce your surplus — but it does build wealth, and in retirement your drawdown drops by this amount since you stop investing it." />
        <Slider label="Invested on top of spend / yr" value={sc.investExtra} min={0} max={400000} step={1000} onChange={(v) => set({ investExtra: v })} money
          info="Investing ABOVE your spend budget — funded by income beyond spend (bonuses, surplus). This must fit within income − spend − extra repayments (see the cashflow check). Both this and the within-budget investing go into the outside-super pool that funds early retirement." />
        <Slider label="Employer super → super (net of 15% tax)" value={sc.superContrib} min={0} max={150000} step={500} onChange={(v) => set({ superContrib: v })} money
          info="Annual contributions going INTO super (employer SG plus any salary sacrifice), after the 15% contributions tax. Grows the locked super pool — great long-term, but unavailable until the preservation age." />
        <Slider label="Annual spend (incl. mortgage & all mandatory costs)" value={sc.spend} min={20000} max={400000} step={1000} onChange={(v) => set({ spend: v })} money
          info="Your total yearly outgoings in today's dollars — everything, INCLUDING the mortgage. Once the loan is paid off, the model automatically drops your spend by the repayment (mortgage-free is cheaper). This is the main driver of how big a pot you need." />
        <Slider label="Plan to age" value={sc.longevity} min={80} max={105} step={1} onChange={(v) => set({ longevity: v })}
          info="The age you want the money to last to. The projection runs to here; 'money lasts' checks the pool survives the whole way. A longer horizon is a more conservative plan." />
        <div>
          <label className={labelClass}>Starting outside super</label>
          <input className={inputClass} type="number" inputMode="decimal" value={sc.startOutside === 0 ? "" : sc.startOutside} onChange={(e) => set({ startOutside: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className={labelClass}>Starting super</label>
          <input className={inputClass} type="number" inputMode="decimal" value={sc.startSuper === 0 ? "" : sc.startSuper} onChange={(e) => set({ startSuper: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className={labelClass}>Current age</label>
          <input className={inputClass} type="number" inputMode="decimal" value={sc.currentAge === 0 ? "" : sc.currentAge} onChange={(e) => set({ currentAge: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className={labelClass}>Fixed target (blank = spend ÷ rate)</label>
          <input className={inputClass} type="number" value={sc.target ?? ""} placeholder={fmt0(sc.spend * (100 / sc.swr))} onChange={(e) => set({ target: e.target.value === "" ? null : parseFloat(e.target.value) })} />
        </div>
      </div>

      {savedMsg && <p className="text-[12px] text-gbx-teal font-body">{savedMsg}</p>}
    </div>
  );
}
