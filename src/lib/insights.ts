import type Database from "better-sqlite3";
import { computeNetWorth } from "./portfolio";

// ---------------------------------------------------------------------------
// Household settings (shared key/value store)
// ---------------------------------------------------------------------------

export function getSetting<T>(db: Database.Database, key: string, fallback: T): T {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Freedom Number (FIRE + Coast FIRE)
// ---------------------------------------------------------------------------

export interface FireSettings {
  swr: number; // safe withdrawal rate %, e.g. 4 → 25× spend target
  realReturn: number; // NOMINAL return % fallback (name kept for storage compat)
  inflation: number; // assumed inflation %, to convert nominal → real
  annualSpend: number | null; // manual override; null → derived from transactions
  targetOverride: number | null; // fixed $ FIRE target; overrides the spend×SWR target
  includeHome: boolean; // count home equity toward the invested figure?
  currentAge: number | null; // manual fallback age (used if no birth dates)
  birthP1: string | null; // person1 birth month, "YYYY-MM"
  birthP2: string | null; // person2 birth month, "YYYY-MM"
  retireAge: number; // preservation / target retirement age, e.g. 60
}

export const DEFAULT_FIRE: FireSettings = {
  swr: 4,
  realReturn: 7.5, // nominal fallback
  inflation: 2.5,
  annualSpend: null,
  targetOverride: null,
  includeHome: false,
  currentAge: null,
  birthP1: null,
  birthP2: null,
  retireAge: 60,
};

// Convert a nominal return to a real (after-inflation) return, both in %.
export function realFromNominal(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

// Fractional current age from a "YYYY-MM" birth month (assumes mid-month).
function ageFromYearMonth(ym: string | null): number | null {
  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return null;
  const birth = new Date(Date.UTC(y, m - 1, 15));
  if (isNaN(birth.getTime())) return null;
  return (Date.now() - birth.getTime()) / (365.25 * 86_400_000);
}

export function getFireSettings(db: Database.Database): FireSettings {
  return { ...DEFAULT_FIRE, ...getSetting(db, "fire", {} as Partial<FireSettings>) };
}

// ---------------------------------------------------------------------------
// User profile (household + per-person facts that feed the calculations)
// ---------------------------------------------------------------------------

export interface PersonProfile {
  birth: string | null; // "YYYY-MM"
  income: number | null; // gross annual salary, AUD (before tax; super is on top)
  sgRate: number | null; // employer super contribution %, paid on top of salary
}

// Australian resident income tax for 2024-25+ (Stage 3 scale) plus the 2%
// Medicare levy. A planning approximation — ignores offsets, HELP, levy
// thresholds/surcharge. Returns annual tax payable on a gross salary.
export function incomeTaxAU(gross: number): number {
  let tax = 0;
  if (gross > 190000) tax = 51638 + (gross - 190000) * 0.45;
  else if (gross > 135000) tax = 31288 + (gross - 135000) * 0.37;
  else if (gross > 45000) tax = 4288 + (gross - 45000) * 0.3;
  else if (gross > 18200) tax = (gross - 18200) * 0.16;
  const medicare = gross > 0 ? gross * 0.02 : 0;
  return tax + medicare;
}

export function afterTaxAU(gross: number): number {
  if (gross <= 0) return 0;
  return gross - incomeTaxAU(gross);
}
export interface Profile {
  p1: PersonProfile;
  p2: PersonProfile;
  riskLevel: string | null; // key of RISK_LEVELS
  desiredReturn: number | null; // explicit real return %, overrides the risk mapping
  annualSpend: number | null; // MANUAL household spend, AUD/yr
  annualInvest: number | null; // MANUAL amount invested outside super each year, AUD/yr
}

// Risk level → expected NOMINAL return % (before inflation). Rough long-run
// planning figures for a diversified portfolio at each growth/defensive mix.
export const RISK_LEVELS: { key: string; label: string; nominalReturn: number; blurb: string }[] = [
  { key: "conservative", label: "Conservative", nominalReturn: 5.0, blurb: "~30% growth / 70% defensive" },
  { key: "moderate", label: "Moderate", nominalReturn: 6.5, blurb: "~50/50 growth / defensive" },
  { key: "balanced", label: "Balanced", nominalReturn: 7.5, blurb: "~70% growth / 30% defensive" },
  { key: "growth", label: "Growth", nominalReturn: 8.5, blurb: "~85% growth" },
  { key: "high_growth", label: "High growth", nominalReturn: 9.5, blurb: "~100% growth" },
];

export function riskToReturn(level: string | null): number | null {
  if (!level) return null;
  return RISK_LEVELS.find((r) => r.key === level)?.nominalReturn ?? null;
}

export const DEFAULT_PROFILE: Profile = {
  p1: { birth: null, income: null, sgRate: null },
  p2: { birth: null, income: null, sgRate: null },
  riskLevel: null,
  desiredReturn: null,
  annualSpend: null,
  annualInvest: null,
};

export const DEFAULT_SG_RATE = 12; // % employer super guarantee (on top of salary)
const SUPER_CONTRIB_TAX = 0.15; // 15% tax on concessional contributions

// Aggregate mortgage picture across all loan accounts, for FIRE projections.
export interface MortgageSummary {
  hasMortgage: boolean;
  propertyValue: number; // total property assets
  loanBalance: number; // positive amount owing
  rate: number; // balance-weighted annual %
  monthlyRepayment: number;
  annualRepayment: number;
}

export function getMortgageSummary(db: Database.Database): MortgageSummary {
  const totals = computeNetWorth(db);
  const propertyValue = Math.max(0, totals.byType.property || 0);
  const loans = db
    .prepare(
      `SELECT a.interest_rate as rate, a.repayment_amount as rep,
        (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as bal
       FROM accounts a WHERE a.type = 'loan'`
    )
    .all() as { rate: number | null; rep: number | null; bal: number | null }[];

  let loanBalance = 0;
  let monthlyRepayment = 0;
  let rateWeighted = 0;
  for (const l of loans) {
    const owing = Math.abs(l.bal || 0);
    loanBalance += owing;
    monthlyRepayment += l.rep || 0;
    rateWeighted += owing * (l.rate || 0);
  }
  const rate = loanBalance > 0 ? rateWeighted / loanBalance : 0;
  return {
    hasMortgage: loanBalance > 0,
    propertyValue,
    loanBalance,
    rate,
    monthlyRepayment,
    annualRepayment: monthlyRepayment * 12,
  };
}

export function getProfile(db: Database.Database): Profile {
  const raw = getSetting(db, "profile", {} as Partial<Profile>);
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    p1: { ...DEFAULT_PROFILE.p1, ...(raw.p1 || {}) },
    p2: { ...DEFAULT_PROFILE.p2, ...(raw.p2 || {}) },
  };
}

// Solve for the number of years t such that
//   present*(1+r)^t + save*(((1+r)^t - 1)/r) = target
// via bisection. Returns null when unreachable within 100 years.
function yearsToTarget(present: number, target: number, r: number, save: number): number | null {
  if (present >= target) return 0;
  const fv = (t: number) => {
    const g = Math.pow(1 + r, t);
    const annuity = Math.abs(r) < 1e-9 ? save * t : save * ((g - 1) / r);
    return present * g + annuity;
  };
  if (fv(100) < target) return null; // not reachable in a lifetime of saving
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface FreedomResult {
  configured: boolean;
  reason?: string;
  settings: FireSettings;
  netWorth: number;
  homeEquity: number;
  investedNow: number;
  superBalance: number; // current super (locked until preservation age)
  annualSpend: number | null;
  spendDerived: boolean;
  annualIncome: number | null; // take-home (after tax)
  annualSavings: number | null; // discretionary + net employer super
  householdGross: number; // total gross salaries
  householdNet: number; // total after-tax
  superContribNet: number; // net employer super into super each year (auto)
  annualInvest: number; // MANUAL amount invested outside super each year
  discretionarySavings: number | null; // == annualInvest (kept for the scenario seed)
  fireTarget: number | null;
  targetFixed: boolean;
  sustainableSpend: number | null;
  progressPct: number | null;
  yearsToFire: number | null;
  fireDate: string | null;
  fireAge: number | null;
  ageP1: number | null;
  ageP2: number | null;
  effectiveAge: number | null; // older partner; drives Coast + FIRE age
  effectiveReturn: number; // REAL return % actually used (nominal − inflation)
  effectiveNominal: number; // the nominal return that real was derived from
  inflation: number; // inflation % used for the conversion
  returnSource: "desired" | "risk" | "default";
  riskLevel: string | null;
  incomeFromProfile: boolean;
  // Coast FIRE
  coastNumber: number | null;
  coastReached: boolean | null;
  coastProgressPct: number | null;
  // Bridge to preservation age (retiring before super unlocks)
  bridge: BridgeInfo;
}

export interface BridgeInfo {
  needed: boolean; // retiring before the preservation age?
  covered: boolean | null; // does outside-super cover the gap? null if unknown
  shortfallAge: number | null; // age outside-super runs out, if it does
  outsideAtRetire: number | null; // outside-super balance at the retirement age
  gapYears: number;
  preservationAge: number;
}

const PRESERVATION_AGE = 60;

export function computeFreedom(db: Database.Database): FreedomResult {
  const s = getFireSettings(db);
  const profile = getProfile(db);
  const totals = computeNetWorth(db);
  const netWorth = totals.totalNetWorth;
  const homeEquity = (totals.byType.property || 0) + (totals.byType.loan || 0); // loan is negative
  const investedNow = s.includeHome ? netWorth : netWorth - homeEquity;

  // Birth months: profile is the source of truth, with the FIRE setting as a
  // fallback. Ages computed live. Coast FIRE uses the OLDER partner as the
  // binding constraint — the target must be reached by the earlier retirement.
  const birthP1 = profile.p1.birth ?? s.birthP1;
  const birthP2 = profile.p2.birth ?? s.birthP2;
  const ageP1 = ageFromYearMonth(birthP1);
  const ageP2 = ageFromYearMonth(birthP2);
  const derivedAges = [ageP1, ageP2].filter((a): a is number => a != null);
  const effectiveAge = derivedAges.length ? Math.max(...derivedAges) : s.currentAge;

  // Expected return. The user enters a NOMINAL return (desired override, or the
  // risk-level mapping, else the fallback); we convert to a REAL return using the
  // inflation assumption, because the whole model runs in today's dollars.
  let nominalReturn = s.realReturn; // stored fallback (nominal)
  let returnSource: "desired" | "risk" | "default" = "default";
  if (profile.desiredReturn != null && profile.desiredReturn > 0) {
    nominalReturn = profile.desiredReturn;
    returnSource = "desired";
  } else {
    const rr = riskToReturn(profile.riskLevel);
    if (rr != null) {
      nominalReturn = rr;
      returnSource = "risk";
    }
  }
  const inflation = s.inflation ?? 2.5;
  const effectiveReturn = Math.round(realFromNominal(nominalReturn, inflation) * 100) / 100;

  // Spend is MANUAL (Profile, or the FIRE-setting fallback). No longer estimated
  // from transactions — the spending table isn't the source of truth here.
  const annualSpend =
    profile.annualSpend != null && profile.annualSpend > 0
      ? profile.annualSpend
      : s.annualSpend != null && s.annualSpend > 0
        ? s.annualSpend
        : null;
  const spendDerived = false; // always manual now

  // Auto: salaries → after-tax take-home, and employer super (SG) paid on TOP of
  // salary, net of 15% contributions tax. These are the "unavoidable" flows.
  const taxed = (p: PersonProfile) => {
    const g = p.income || 0;
    if (g <= 0) return { gross: 0, net: 0, superNet: 0 };
    return {
      gross: g,
      net: afterTaxAU(g),
      superNet: g * ((p.sgRate ?? DEFAULT_SG_RATE) / 100) * (1 - SUPER_CONTRIB_TAX),
    };
  };
  const t1 = taxed(profile.p1);
  const t2 = taxed(profile.p2);
  const householdGross = t1.gross + t2.gross;
  const householdNet = t1.net + t2.net;
  const superContribNet = t1.superNet + t2.superNet;
  const incomeFromProfile = householdGross > 0;

  // Take-home income (after tax), shown for context. Employer super still accrues
  // automatically. But the amount actually INVESTED outside super each year is a
  // MANUAL figure, not derived from income − spend.
  const annualIncome = incomeFromProfile ? householdNet : null;
  const annualInvest = profile.annualInvest != null && profile.annualInvest > 0 ? profile.annualInvest : 0;
  const discretionarySavings = annualInvest; // outside-super, manual
  // Total added to invested wealth each year = manual outside invest + net SG.
  const annualSavings = annualInvest + (incomeFromProfile ? superContribNet : 0);

  const base: FreedomResult = {
    configured: false,
    settings: s,
    netWorth,
    homeEquity,
    investedNow,
    superBalance: totals.byType.super || 0,
    annualSpend,
    spendDerived,
    annualIncome,
    annualSavings,
    householdGross,
    householdNet,
    superContribNet,
    annualInvest,
    discretionarySavings,
    fireTarget: null,
    targetFixed: false,
    sustainableSpend: null,
    progressPct: null,
    yearsToFire: null,
    fireDate: null,
    fireAge: null,
    ageP1,
    ageP2,
    effectiveAge,
    effectiveReturn,
    effectiveNominal: nominalReturn,
    inflation,
    returnSource,
    riskLevel: profile.riskLevel,
    incomeFromProfile,
    coastNumber: null,
    coastReached: null,
    coastProgressPct: null,
    bridge: {
      needed: false,
      covered: null,
      shortfallAge: null,
      outsideAtRetire: null,
      gapYears: 0,
      preservationAge: PRESERVATION_AGE,
    },
  };

  // A fixed dollar target (if set) wins; otherwise derive it from spend × 1/SWR.
  const targetFixed = s.targetOverride != null && s.targetOverride > 0;
  const fireTarget = targetFixed
    ? (s.targetOverride as number)
    : annualSpend && annualSpend > 0
      ? annualSpend * (100 / s.swr)
      : null;

  if (fireTarget == null) {
    return { ...base, reason: "no-target" };
  }

  // What that pot sustainably supports per year at the withdrawal rate.
  const sustainableSpend = (fireTarget * s.swr) / 100;
  const progressPct = fireTarget > 0 ? (investedNow / fireTarget) * 100 : null;
  const r = effectiveReturn / 100;
  const save = annualSavings != null && annualSavings > 0 ? annualSavings : 0;
  const yearsToFire = yearsToTarget(investedNow, fireTarget, r, save);
  let fireDate: string | null = null;
  let fireAge: number | null = null;
  if (yearsToFire != null) {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(yearsToFire * 365.25));
    fireDate = d.toISOString().slice(0, 10);
    if (effectiveAge != null) fireAge = Math.round((effectiveAge + yearsToFire) * 10) / 10;
  }

  let coastNumber: number | null = null;
  let coastReached: boolean | null = null;
  let coastProgressPct: number | null = null;
  if (effectiveAge != null && s.retireAge > effectiveAge) {
    const yrs = s.retireAge - effectiveAge;
    coastNumber = fireTarget / Math.pow(1 + r, yrs);
    coastReached = investedNow >= coastNumber;
    coastProgressPct = coastNumber > 0 ? (investedNow / coastNumber) * 100 : null;
  }

  // Bridge: retiring before the preservation age means outside-super has to fund
  // the gap years (super is locked). Lightweight two-phase check in real terms.
  const bridge = { ...base.bridge };
  const superNow = totals.byType.super || 0;
  if (effectiveAge != null && s.retireAge > effectiveAge) {
    if (s.retireAge >= PRESERVATION_AGE) {
      bridge.needed = false;
      bridge.covered = true;
    } else {
      bridge.needed = true;
      bridge.gapYears = PRESERVATION_AGE - Math.round(s.retireAge);
      const disc = discretionarySavings != null && discretionarySavings > 0 ? discretionarySavings : 0;
      let out = Math.max(0, netWorth - homeEquity - superNow); // outside super now
      for (let a = Math.floor(effectiveAge); a < s.retireAge; a++) out = out * (1 + r) + disc;
      bridge.outsideAtRetire = out;
      let shortfallAge: number | null = null;
      for (let a = Math.floor(s.retireAge); a < PRESERVATION_AGE; a++) {
        out = out * (1 + r) - (annualSpend || 0);
        if (out <= 0) { shortfallAge = a + 1; break; }
      }
      bridge.shortfallAge = shortfallAge;
      bridge.covered = shortfallAge == null;
    }
  }

  return {
    ...base,
    configured: true,
    fireTarget,
    targetFixed,
    sustainableSpend,
    progressPct,
    yearsToFire,
    fireDate,
    fireAge,
    coastNumber,
    coastReached,
    coastProgressPct,
    bridge,
  };
}

// ---------------------------------------------------------------------------
// Anomaly watchdog — self-diagnosing checks over the stored data
// ---------------------------------------------------------------------------

export type Severity = "alert" | "warn" | "info";
export interface Anomaly {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

const SEV_RANK: Record<Severity, number> = { alert: 0, warn: 1, info: 2 };

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date((iso.length <= 10 ? iso + "T00:00:00Z" : iso)).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function detectAnomalies(db: Database.Database): Anomaly[] {
  const out: Anomaly[] = [];

  // 1. Implausible net-worth jumps between consecutive snapshots (would have
  //    caught the super drift bug). A diversified balance sheet doesn't move
  //    >8% day-to-day; a jump that big over a short gap is almost always a data
  //    glitch, not a real move.
  const snaps = db
    .prepare("SELECT date, total_net_worth as nw FROM snapshots ORDER BY date ASC")
    .all() as { date: string; nw: number }[];
  const jumps: string[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    if (prev.nw <= 0) continue;
    const gap =
      (new Date(cur.date).getTime() - new Date(prev.date).getTime()) / 86_400_000;
    const pct = ((cur.nw - prev.nw) / Math.abs(prev.nw)) * 100;
    if (gap <= 4 && Math.abs(pct) > 8) {
      jumps.push(`${cur.date} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
    }
  }
  if (jumps.length > 0) {
    const recent = jumps.slice(-3).reverse();
    out.push({
      id: "snapshot-jump",
      severity: "alert",
      title: `Net worth jumped implausibly on ${jumps.length} day${jumps.length > 1 ? "s" : ""}`,
      detail: `${recent.join(", ")}${jumps.length > 3 ? ` (+${jumps.length - 3} more)` : ""}. A diversified balance sheet doesn't move this fast — likely a data glitch. Consider Settings → Rebuild History.`,
    });
  }

  // 2. Snapshot / cron health — no fresh snapshot means the daily job stopped.
  const latest = snaps.length ? snaps[snaps.length - 1].date : null;
  const snapAge = daysSince(latest);
  if (snapAge != null && snapAge >= 2) {
    out.push({
      id: "cron-stale",
      severity: "warn",
      title: "Daily snapshot is behind",
      detail: `Last snapshot was ${snapAge} days ago (${latest}). The daily job may not be running — open the app or check the cron.`,
    });
  }

  // 3. Stale super anchor — proxy drifts from the real balance over time.
  const supers = db
    .prepare(
      `SELECT a.name as name, sc.anchor_date as anchor_date, sc.unit_price_date as upd
       FROM super_config sc JOIN accounts a ON sc.account_id = a.id`
    )
    .all() as { name: string; anchor_date: string | null; upd: string | null }[];
  for (const su of supers) {
    const age = daysSince(su.anchor_date || su.upd);
    if (age != null && age >= 120) {
      out.push({
        id: `super-anchor-${su.name}`,
        severity: "info",
        title: `${su.name} anchored ${age} days ago`,
        detail: `Re-anchor from the latest statement (Edit → save) so the proxy stays close to the real balance.`,
      });
    }
  }

  // 4. Stale / missing prices on held tickers.
  const priceRows = db
    .prepare(
      `SELECT UPPER(h.ticker) as ticker, pc.updated_at as updated_at, pc.price as price,
              pc.change_percent as chg
       FROM (SELECT DISTINCT UPPER(ticker) as ticker FROM holdings WHERE units > 0) h
       LEFT JOIN price_cache pc ON h.ticker = UPPER(pc.ticker)`
    )
    .all() as { ticker: string; updated_at: string | null; price: number | null; chg: number | null }[];
  const missing = priceRows.filter((r) => r.price == null).map((r) => r.ticker);
  const stale = priceRows
    .filter((r) => r.price != null && (daysSince(r.updated_at) ?? 0) >= 3)
    .map((r) => ({ ticker: r.ticker, age: daysSince(r.updated_at) ?? 0 }))
    .sort((a, b) => b.age - a.age);
  if (missing.length > 0) {
    out.push({
      id: "price-missing",
      severity: "warn",
      title: `${missing.length} holding${missing.length > 1 ? "s have" : " has"} no live price`,
      detail: `${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}. Check the ticker symbol or run Refresh Prices.`,
    });
  }
  if (stale.length > 0) {
    out.push({
      id: "price-stale",
      severity: "warn",
      title: `${stale.length} holding${stale.length > 1 ? "s have" : " has"} stale prices`,
      detail: `Oldest ${stale[0].ticker} (${stale[0].age}d). The market feed may be quiet — run Refresh Prices.`,
    });
  }

  // 5. Large single-day moves on held tickers (heads-up, not an error).
  const bigMoves = priceRows
    .filter((r) => r.chg != null && Math.abs(r.chg) >= 8)
    .sort((a, b) => Math.abs(b.chg!) - Math.abs(a.chg!));
  for (const m of bigMoves.slice(0, 3)) {
    out.push({
      id: `move-${m.ticker}`,
      severity: "info",
      title: `${m.ticker} moved ${m.chg! >= 0 ? "+" : ""}${m.chg!.toFixed(1)}% today`,
      detail: `A large single-day move — worth a look.`,
    });
  }

  // 6. DRP units waiting to be applied.
  const drp = db
    .prepare(
      `SELECT COUNT(*) as n FROM holdings WHERE drp_units_pending > 0.0001`
    )
    .get() as { n: number };
  if (drp.n > 0) {
    out.push({
      id: "drp-pending",
      severity: "info",
      title: `${drp.n} holding${drp.n > 1 ? "s have" : " has"} estimated DRP units to apply`,
      detail: `Reinvested distributions were detected — review and apply them on the Holdings tab.`,
    });
  }

  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}
