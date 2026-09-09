"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  Line,
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
  annualSpend: number | null;
  annualSavings: number | null;
  effectiveReturn: number; // real
  effectiveNominal: number;
  inflation: number;
  effectiveAge: number | null;
  settings: { swr: number; targetOverride: number | null; retireAge: number; includeHome: boolean };
  mortgage: Mortgage;
}

// Nominal → real return, both %.
function realFromNominal(nom: number, infl: number): number {
  return ((1 + nom / 100) / (1 + infl / 100) - 1) * 100;
}

type Strategy = "schedule" | "payoff_now" | "payoff_retire";

interface Scenario {
  startLiquid: number; // investable, excluding home
  currentAge: number;
  accReturn: number; // NOMINAL %
  retReturn: number; // NOMINAL %
  inflation: number; // %
  savings: number; // annual, into investments while mortgage is on schedule
  extra: number;
  spend: number; // annual living spend in retirement, EXCLUDING mortgage
  swr: number;
  target: number | null;
  retireAge: number;
  longevity: number;
  includeHomeInTarget: boolean;
  // mortgage
  propertyValue: number;
  propGrowth: number; // % real
  loanBalance: number;
  loanRate: number; // annual %
  annualRepayment: number;
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

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors tabular-nums";
const labelClass =
  "block text-[10px] uppercase tracking-[0.14em] font-body font-medium text-gbx-muted mb-1";

function Slider({
  label, value, min, max, step, onChange, suffix, money,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix?: string; money?: boolean;
}) {
  // Typed value can go beyond the slider's range; the range control clamps.
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1 gap-2">
        <label className={labelClass + " mb-0"}>{label}</label>
        <span className="flex items-center gap-1 shrink-0">
          {money && <span className="text-sm text-gbx-muted font-data">$</span>}
          <input
            type="number"
            value={value}
            step={step}
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
  points: { age: number; netWorth: number; liquid: number; loan: number }[];
  fireAge: number | null;
  yearsToFire: number | null;
  progressPct: number | null;
  potAtRetirement: number | null;
  depletionAge: number | null;
  mortgageClearAge: number | null;
  endNetWorth: number;
  endLiquid: number;
}

// Project a scenario year by year. Liquid (investable) and the mortgage are
// tracked separately; home equity = property − loan. Drawdown sustainability is
// judged on LIQUID (you can't spend the house); the FIRE target is measured on
// net worth or liquid per includeHomeInTarget.
function projectScenario(sc: Scenario, strategy: Strategy): ProjResult {
  const target =
    sc.target && sc.target > 0 ? sc.target : sc.spend > 0 ? sc.spend * (100 / sc.swr) : 0;
  // Returns are entered NOMINAL; the projection runs in today's dollars, so
  // convert to real. Property growth is already entered in real terms.
  const accR = realFromNominal(sc.accReturn, sc.inflation) / 100;
  const retR = realFromNominal(sc.retReturn, sc.inflation) / 100;
  const propG = sc.propGrowth / 100;
  const mRate = sc.loanRate / 100 / 12;
  const monthlyRep = sc.annualRepayment / 12;
  const startAge = Math.floor(sc.currentAge);

  let liquid = sc.startLiquid;
  let loan = sc.loanBalance;
  let prop = sc.propertyValue;
  let fireAge: number | null = null;
  let depletionAge: number | null = null;
  let potAtRetirement: number | null = null;
  let mortgageClearAge: number | null = loan <= 0 ? startAge : null;

  // Pay off now (from liquid) before the timeline starts.
  if (strategy === "payoff_now" && loan > 0) {
    const pay = Math.min(loan, Math.max(0, liquid));
    liquid -= pay;
    loan -= pay;
    if (loan <= 0) mortgageClearAge = startAge;
  }

  const points: ProjResult["points"] = [];

  for (let age = startAge; age <= sc.longevity; age++) {
    // Pay off at retirement (lump from liquid) at the start of that year.
    if (strategy === "payoff_retire" && age === Math.floor(sc.retireAge) && loan > 0) {
      const pay = Math.min(loan, Math.max(0, liquid));
      liquid -= pay;
      loan -= pay;
      if (loan <= 0 && mortgageClearAge == null) mortgageClearAge = age;
    }

    const homeEquity = prop - loan;
    const netWorth = liquid + homeEquity;
    points.push({
      age,
      netWorth: Math.round(netWorth),
      liquid: Math.round(Math.max(0, liquid)),
      loan: Math.round(Math.max(0, loan)),
    });

    const metric = sc.includeHomeInTarget ? netWorth : liquid;
    if (fireAge == null && target > 0 && metric >= target) fireAge = age;
    if (age === Math.floor(sc.retireAge)) potAtRetirement = liquid;

    // Was the mortgage active this year (drives whether repayment is a cost or
    // freed to save)?
    const mortgageActive = loan > 0;

    // Amortise the loan over 12 months.
    for (let m = 0; m < 12 && loan > 0; m++) {
      const interest = loan * mRate;
      let pay = monthlyRep;
      if (pay > loan + interest) pay = loan + interest;
      loan = loan + interest - pay;
      if (loan < 0) loan = 0;
    }
    if (mortgageActive && loan <= 0 && mortgageClearAge == null) mortgageClearAge = age;

    // Cashflow. Savings is the amount invested WHILE the mortgage is on
    // schedule; once it's gone, the old repayment is freed to invest. In
    // retirement, an active mortgage adds to the drawdown.
    if (age < sc.retireAge) {
      const contribution = sc.savings + sc.extra + (mortgageActive ? 0 : sc.annualRepayment);
      liquid = liquid * (1 + accR) + contribution;
    } else {
      const draw = sc.spend + (mortgageActive ? sc.annualRepayment : 0);
      liquid = liquid * (1 + retR) - draw;
      if (liquid <= 0 && depletionAge == null) {
        depletionAge = age + 1;
        liquid = 0;
      }
    }
    prop = prop * (1 + propG);
  }

  const yearsToFire = fireAge != null ? fireAge - sc.currentAge : null;
  const startMetric = sc.includeHomeInTarget ? sc.startLiquid + (sc.propertyValue - sc.loanBalance) : sc.startLiquid;
  const progressPct = target > 0 ? (startMetric / target) * 100 : null;

  return {
    target,
    points,
    fireAge,
    yearsToFire,
    progressPct,
    potAtRetirement,
    depletionAge,
    mortgageClearAge,
    endNetWorth: points.length ? points[points.length - 1].netWorth : 0,
    endLiquid: points.length ? points[points.length - 1].liquid : 0,
  };
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  schedule: "Pay on schedule",
  payoff_now: "Pay off now",
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
    const startLiquid = Math.round(b.netWorth - homeEquity);
    const nominal = b.effectiveNominal || 7.5;
    return {
      startLiquid,
      currentAge: b.effectiveAge != null ? Math.round(b.effectiveAge) : 40,
      accReturn: nominal,
      retReturn: Math.max(3, nominal - 1),
      inflation: b.inflation ?? 2.5,
      savings: Math.max(0, Math.round(b.annualSavings ?? 0)),
      extra: 0,
      spend: Math.round(spend),
      swr: b.settings.swr,
      target: b.settings.targetOverride,
      retireAge: b.settings.retireAge,
      longevity: 95,
      includeHomeInTarget: b.settings.includeHome,
      propertyValue: Math.round(b.mortgage.propertyValue),
      propGrowth: 0,
      loanBalance: Math.round(b.mortgage.loanBalance),
      loanRate: b.mortgage.rate || 6,
      annualRepayment: Math.round(b.mortgage.annualRepayment),
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
  // For the comparison table, run all three mortgage strategies.
  const comparison = useMemo(() => {
    if (!sc || !sc.loanBalance) return null;
    return (["schedule", "payoff_now", "payoff_retire"] as Strategy[]).map((s) => ({
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

  const outcomeTiles: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "FIRE target", value: fmt0(result.target) },
    {
      label: "Work-optional at",
      value: result.fireAge != null ? `age ${result.fireAge} (${result.yearsToFire!.toFixed(0)} yr)` : "not reached",
      tone: result.fireAge != null ? "good" : "bad",
    },
    {
      label: "Mortgage clear",
      value: !hasMortgage ? "already clear" : result.mortgageClearAge != null ? `age ${Math.round(result.mortgageClearAge)}` : `after age ${sc.longevity}`,
    },
    { label: `Liquid at age ${sc.retireAge}`, value: result.potAtRetirement != null ? fmt0(result.potAtRetirement) : "—" },
    {
      label: "Money lasts",
      value: result.depletionAge == null ? `past age ${sc.longevity} ✓` : `until age ${result.depletionAge}`,
      tone: result.depletionAge == null ? "good" : "bad",
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
            <p>
              Your <strong>liquid</strong> assets (investments &amp; cash) and the <strong>mortgage</strong> are
              tracked separately; net worth = liquid + home equity. Whether your money &ldquo;lasts&rdquo; is judged on
              liquid assets only — you can&apos;t spend the house.
            </p>
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
      <p className="text-[11px] text-gbx-muted font-body -mt-3">
        Returns are entered <strong>nominal</strong>; at {sc.inflation}% inflation that&apos;s{" "}
        <span className="text-gbx-charcoal">{realFromNominal(sc.accReturn, sc.inflation).toFixed(1)}% real</span>{" "}
        (accumulation) /{" "}
        <span className="text-gbx-charcoal">{realFromNominal(sc.retReturn, sc.inflation).toFixed(1)}% real</span>{" "}
        (retirement). When your real return sits above the withdrawal rate the pot keeps growing, so
        the <em>estate</em> figure is an output of that surplus — the goal is reaching the target and
        the money lasting, not the terminal number.
      </p>

      {/* Projection chart: net worth + liquid */}
      <div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={result.points} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2E8B6E" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#2E8B6E" stopOpacity={0.02} />
              </linearGradient>
            </defs>
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
            <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#2E8B6E" strokeWidth={2} fill="url(#nwFill)" />
            <Line type="monotone" dataKey="liquid" name="Liquid" stroke="#C68A2E" strokeWidth={2} dot={false} />
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
                  <strong>Pay on schedule</strong> keeps your cash invested and pays the loan off with its normal
                  repayments (from savings while working, from the portfolio in retirement).
                </p>
                <p className="mb-2">
                  <strong>Pay off now / at retirement</strong> clears the remaining loan with a lump from your liquid
                  assets — a hit to invested capital now, but it stops the repayments (and interest) from then on.
                </p>
                <p>The table shows how each choice changes how long your money lasts.</p>
              </InfoTip>
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((s) => (
                <button
                  key={s}
                  onClick={() => set({ strategy: s })}
                  className={`text-[11px] px-3 py-1.5 font-body border transition-colors ${
                    sc.strategy === s
                      ? "border-gbx-teal text-gbx-teal bg-gbx-teal/5"
                      : "border-gbx-border text-gbx-muted hover:text-gbx-charcoal"
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
                    <th className="text-right font-medium">Money lasts</th>
                    <th className="text-right font-medium">Mortgage clear</th>
                    <th className="text-right font-medium">Net worth @ {sc.longevity}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gbx-border/60">
                  {comparison.map(({ strategy, res }) => (
                    <tr key={strategy} className={sc.strategy === strategy ? "bg-gbx-teal/5" : ""}>
                      <td className="py-2 text-gbx-charcoal">{STRATEGY_LABELS[strategy]}</td>
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
              <input className={inputClass} type="number" value={sc.loanBalance} onChange={(e) => set({ loanBalance: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className={labelClass}>Annual repayment</label>
              <input className={inputClass} type="number" value={sc.annualRepayment} onChange={(e) => set({ annualRepayment: parseFloat(e.target.value) || 0 })} />
            </div>
            <Slider label="Loan interest rate" value={sc.loanRate} min={0} max={12} step={0.1} onChange={(v) => set({ loanRate: v })} suffix="%" />
            <div>
              <label className={labelClass}>Property value</label>
              <input className={inputClass} type="number" value={sc.propertyValue} onChange={(e) => set({ propertyValue: parseFloat(e.target.value) || 0 })} />
            </div>
            <Slider label="Property growth (real)" value={sc.propGrowth} min={-2} max={6} step={0.5} onChange={(v) => set({ propGrowth: v })} suffix="%" />
            <label className="flex items-end gap-2 text-xs text-gbx-muted font-body pb-2">
              <input type="checkbox" checked={sc.includeHomeInTarget} onChange={(e) => set({ includeHomeInTarget: e.target.checked })} />
              Count home equity toward target
            </label>
          </div>
        </div>
      )}

      {/* Core controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <Slider label="Expected return — nominal (accumulation)" value={sc.accReturn} min={0} max={15} step={0.5} onChange={(v) => set({ accReturn: v })} suffix="%" />
        <Slider label="Return in retirement — nominal" value={sc.retReturn} min={0} max={15} step={0.5} onChange={(v) => set({ retReturn: v })} suffix="%" />
        <Slider label="Inflation" value={sc.inflation} min={0} max={8} step={0.1} onChange={(v) => set({ inflation: v })} suffix="%" />
        <Slider label="Withdrawal rate" value={sc.swr} min={2} max={8} step={0.1} onChange={(v) => set({ swr: v })} suffix="%" />
        <Slider label="Retirement age" value={sc.retireAge} min={Math.ceil(sc.currentAge)} max={75} step={1} onChange={(v) => set({ retireAge: v })} />
        <Slider label="Annual saving (after tax, incl. super)" value={sc.savings} min={0} max={400000} step={1000} onChange={(v) => set({ savings: v })} money />
        <Slider label="Living spend in retirement (excl. mortgage)" value={sc.spend} min={20000} max={300000} step={1000} onChange={(v) => set({ spend: v })} money />
        <Slider label="Extra contribution / yr" value={sc.extra} min={0} max={100000} step={500} onChange={(v) => set({ extra: v })} money />
        <Slider label="Plan to age" value={sc.longevity} min={80} max={105} step={1} onChange={(v) => set({ longevity: v })} />
        <div>
          <label className={labelClass}>Starting liquid (excl. home)</label>
          <input className={inputClass} type="number" value={sc.startLiquid} onChange={(e) => set({ startLiquid: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className={labelClass}>Current age</label>
          <input className={inputClass} type="number" value={sc.currentAge} onChange={(e) => set({ currentAge: parseFloat(e.target.value) || 0 })} />
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
