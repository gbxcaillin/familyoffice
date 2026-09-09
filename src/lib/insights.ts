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
  realReturn: number; // expected real (after-inflation) return %, e.g. 5
  annualSpend: number | null; // manual override; null → derived from transactions
  targetOverride: number | null; // fixed $ FIRE target; overrides the spend×SWR target
  includeHome: boolean; // count home equity toward the invested figure?
  currentAge: number | null; // enables Coast FIRE when set
  retireAge: number; // preservation / target retirement age, e.g. 60
}

export const DEFAULT_FIRE: FireSettings = {
  swr: 4,
  realReturn: 5,
  annualSpend: null,
  targetOverride: null,
  includeHome: false,
  currentAge: null,
  retireAge: 60,
};

export function getFireSettings(db: Database.Database): FireSettings {
  return { ...DEFAULT_FIRE, ...getSetting(db, "fire", {} as Partial<FireSettings>) };
}

// Trailing-window flow, annualised. Sums transactions of the given sign over the
// last 365 days and scales by how much history actually exists, so a partial
// year still yields a sensible run-rate. Returns null when there's no data.
function annualisedFlow(db: Database.Database, sign: "income" | "expense"): number | null {
  const cond = sign === "income" ? "amount > 0" : "amount < 0";
  const row = db
    .prepare(
      `SELECT SUM(ABS(amount)) as total,
              MIN(date) as first_date,
              COUNT(*) as n
       FROM transactions
       WHERE ${cond} AND date >= date('now','-365 days')`
    )
    .get() as { total: number | null; first_date: string | null; n: number };
  if (!row || !row.total || !row.first_date || row.n === 0) return null;
  const firstMs = new Date(row.first_date + "T00:00:00Z").getTime();
  const days = Math.max(1, (Date.now() - firstMs) / 86_400_000);
  const window = Math.min(days, 365);
  // Need a little history before annualising, or the run-rate is noise.
  if (window < 14) return null;
  return (row.total * 365) / window;
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
  // Coast FIRE
  coastNumber: number | null;
  coastReached: boolean | null;
  coastProgressPct: number | null;
}

export function computeFreedom(db: Database.Database): FreedomResult {
  const s = getFireSettings(db);
  const totals = computeNetWorth(db);
  const netWorth = totals.totalNetWorth;
  const homeEquity = (totals.byType.property || 0) + (totals.byType.loan || 0); // loan is negative
  const investedNow = s.includeHome ? netWorth : netWorth - homeEquity;

  const derivedSpend = annualisedFlow(db, "expense");
  const annualSpend = s.annualSpend != null && s.annualSpend > 0 ? s.annualSpend : derivedSpend;
  const annualIncome = annualisedFlow(db, "income");
  const annualSavings =
    annualIncome != null && annualSpend != null ? annualIncome - annualSpend : null;

  const base: FreedomResult = {
    configured: false,
    settings: s,
    netWorth,
    homeEquity,
    investedNow,
    annualSpend,
    spendDerived: s.annualSpend == null || s.annualSpend <= 0,
    annualIncome,
    annualSavings,
    fireTarget: null,
    targetFixed: false,
    sustainableSpend: null,
    progressPct: null,
    yearsToFire: null,
    fireDate: null,
    fireAge: null,
    coastNumber: null,
    coastReached: null,
    coastProgressPct: null,
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
  const r = s.realReturn / 100;
  const save = annualSavings != null && annualSavings > 0 ? annualSavings : 0;
  const yearsToFire = yearsToTarget(investedNow, fireTarget, r, save);
  let fireDate: string | null = null;
  let fireAge: number | null = null;
  if (yearsToFire != null) {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(yearsToFire * 365.25));
    fireDate = d.toISOString().slice(0, 10);
    if (s.currentAge != null) fireAge = Math.round((s.currentAge + yearsToFire) * 10) / 10;
  }

  let coastNumber: number | null = null;
  let coastReached: boolean | null = null;
  let coastProgressPct: number | null = null;
  if (s.currentAge != null && s.retireAge > s.currentAge) {
    const yrs = s.retireAge - s.currentAge;
    coastNumber = fireTarget / Math.pow(1 + r, yrs);
    coastReached = investedNow >= coastNumber;
    coastProgressPct = coastNumber > 0 ? (investedNow / coastNumber) * 100 : null;
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
