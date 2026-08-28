import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getQuotes } from "./market";
import { upsertQuote } from "./portfolio";

// A superannuation account is valued as units * unit_price. The unit price
// tracks the fund's investment option; units grow as estimated contributions
// buy more units each pay cycle. This keeps the balance current without the
// user re-entering it — the account's daily `balances` row is written from
// here, so net worth and the drill-down pick super up with no other changes.

export type PriceSource = "proxy" | "manual" | "feed";
export type ContribMethod = "sg" | "fixed" | "none";
export type PayFrequency = "weekly" | "fortnightly" | "monthly";

export interface BasketLeg {
  ticker: string;
  weight: number; // fraction, legs sum to ~1
}

export interface SuperConfig {
  account_id: string;
  account_name: string;
  owner: string;
  fund_name: string | null;
  option_name: string | null;
  price_source: PriceSource;
  unit_price: number | null;
  unit_price_date: string | null;
  units: number | null;
  fee_annual: number | null;
  basket: string | null; // JSON BasketLeg[]
  basket_base: string | null; // JSON Record<ticker, price>
  feed_url: string | null;
  feed_path: string | null;
  contrib_method: ContribMethod;
  salary: number | null;
  sg_rate: number | null;
  extra_per_period: number | null;
  pay_frequency: PayFrequency;
  contrib_tax: number | null;
  last_contrib_date: string | null;
}

// Default proxy basket for an *indexed* option (e.g. ART High Growth Index).
// Australian shares / international shares / fixed income, tracked with liquid
// AUD-quoted ASX ETFs. Indexed options track these baskets closely, so the
// synthetic unit price follows the real option without scraping the fund site.
export const DEFAULT_HIGH_GROWTH_INDEX_BASKET: BasketLeg[] = [
  { ticker: "VAS.AX", weight: 0.3875 }, // Australian shares
  { ticker: "VGS.AX", weight: 0.5125 }, // International shares
  { ticker: "VAF.AX", weight: 0.1 }, // Fixed income
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function payPeriodsPerYear(freq: PayFrequency): number {
  switch (freq) {
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "fortnightly":
    default:
      return 26;
  }
}

// Net dollars added to the account per pay period, after the 15% contributions
// tax on concessional (employer SG + salary sacrifice) amounts.
export function estimatePerPeriodNet(cfg: SuperConfig): number {
  if (cfg.contrib_method === "none") return 0;
  const periods = payPeriodsPerYear(cfg.pay_frequency);
  const tax = cfg.contrib_tax ?? 0.15;
  let grossPerPeriod = 0;
  if (cfg.contrib_method === "sg") {
    const salary = cfg.salary ?? 0;
    const rate = cfg.sg_rate ?? 0.12;
    grossPerPeriod = (salary * rate) / periods;
  }
  grossPerPeriod += cfg.extra_per_period ?? 0;
  return grossPerPeriod * (1 - tax);
}

function parseBasket(cfg: SuperConfig): BasketLeg[] {
  if (!cfg.basket) return [];
  try {
    const arr = JSON.parse(cfg.basket);
    if (Array.isArray(arr)) return arr as BasketLeg[];
  } catch {
    // ignore malformed
  }
  return [];
}

function parseBasketBase(cfg: SuperConfig): Record<string, number> {
  if (!cfg.basket_base) return {};
  try {
    const obj = JSON.parse(cfg.basket_base);
    if (obj && typeof obj === "object") return obj as Record<string, number>;
  } catch {
    // ignore malformed
  }
  return {};
}

function yearsBetween(fromISO: string | null, toISO: string): number {
  if (!fromISO) return 0;
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  if (isNaN(from) || isNaN(to) || to <= from) return 0;
  return (to - from) / (365.25 * MS_PER_DAY);
}

// Move a date forward by one pay period. Fortnightly/weekly are fixed day
// counts; monthly steps the calendar month (clamped to end of month).
function advancePeriod(dateISO: string, freq: PayFrequency): string {
  const d = new Date(dateISO + "T00:00:00Z");
  if (freq === "monthly") {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    // Handle short months (e.g. Jan 31 -> Feb 28).
    if (d.getUTCDate() < day) d.setUTCDate(0);
  } else {
    d.setUTCDate(d.getUTCDate() + (freq === "weekly" ? 7 : 14));
  }
  return d.toISOString().slice(0, 10);
}

// Compute the current synthetic unit price from the proxy basket: each leg's
// price relative to its anchor, weighted, times the anchor unit price, with an
// annual fee drag applied over the elapsed period.
export function computeProxyUnitPrice(
  cfg: SuperConfig,
  pricesNow: Record<string, number>,
  today: string
): number | null {
  const anchor = cfg.unit_price ?? 1;
  const legs = parseBasket(cfg);
  const base = parseBasketBase(cfg);
  if (legs.length === 0) return cfg.unit_price ?? null;

  let factor = 0;
  let usedWeight = 0;
  for (const leg of legs) {
    const t = leg.ticker.toUpperCase();
    const now = pricesNow[t];
    const b = base[t];
    if (!now || !b) continue;
    factor += leg.weight * (now / b);
    usedWeight += leg.weight;
  }
  if (usedWeight === 0) return cfg.unit_price ?? null;
  // Renormalise in case some legs were unpriced this run.
  factor = factor / usedWeight;

  const fee = cfg.fee_annual ?? 0.001;
  const feeFactor = Math.pow(1 - fee, yearsBetween(cfg.unit_price_date, today));
  return anchor * factor * feeFactor;
}

// Try a JSON feed for the live unit price. feed_path is a dot path into the
// JSON (e.g. "data.0.unitPrice"). Best-effort: returns null on any failure so
// callers fall back to the last known price.
async function fetchFeedUnitPrice(cfg: SuperConfig): Promise<number | null> {
  if (!cfg.feed_url) return null;
  try {
    const res = await fetch(cfg.feed_url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const path = (cfg.feed_path || "").split(".").filter(Boolean);
    let cur: unknown = json;
    for (const key of path) {
      if (cur == null) return null;
      cur = (cur as Record<string, unknown>)[key];
    }
    const num = typeof cur === "string" ? parseFloat(cur) : (cur as number);
    return typeof num === "number" && isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

export interface SuperRefreshResult {
  account_id: string;
  unit_price: number;
  units: number;
  value: number;
  contributed_periods: number;
  contributed_amount: number;
}

// Refresh one super account: accrue any contributions due since the last run,
// recompute the unit price, persist units/price and write the day's value into
// price history and the account's balance row.
export async function refreshSuperAccount(
  db: Database.Database,
  cfg: SuperConfig,
  pricesNow: Record<string, number>
): Promise<SuperRefreshResult> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Determine the current unit price by source.
  let unitPrice = cfg.unit_price ?? 1;
  if (cfg.price_source === "proxy") {
    const p = computeProxyUnitPrice(cfg, pricesNow, today);
    if (p && p > 0) unitPrice = p;
  } else if (cfg.price_source === "feed") {
    const p = await fetchFeedUnitPrice(cfg);
    if (p && p > 0) unitPrice = p;
  }
  // manual: unitPrice stays at the user-entered value.

  // 2. Accrue contributions period-by-period since the last accrual date.
  let units = cfg.units ?? 0;
  let contributedPeriods = 0;
  let contributedAmount = 0;
  const perPeriodNet = estimatePerPeriodNet(cfg);
  let lastContrib = cfg.last_contrib_date || cfg.unit_price_date;

  if (perPeriodNet > 0 && lastContrib && unitPrice > 0) {
    let cursor = advancePeriod(lastContrib, cfg.pay_frequency);
    let guard = 0;
    while (cursor <= today && guard < 5000) {
      units += perPeriodNet / unitPrice;
      contributedPeriods += 1;
      contributedAmount += perPeriodNet;
      lastContrib = cursor;
      cursor = advancePeriod(cursor, cfg.pay_frequency);
      guard += 1;
    }
  }

  const value = units * unitPrice;

  // 3. Persist config (units, unit price/date, last contribution date).
  db.prepare(
    `UPDATE super_config
     SET units = ?, unit_price = ?, unit_price_date = ?, last_contrib_date = ?, updated_at = datetime('now')
     WHERE account_id = ?`
  ).run(units, unitPrice, today, lastContrib || cfg.unit_price_date, cfg.account_id);

  // 4. Write price history for the day (idempotent per account/day).
  db.prepare(
    `INSERT INTO super_price_history (id, account_id, date, unit_price, units, value)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET
       unit_price = excluded.unit_price, units = excluded.units, value = excluded.value`
  ).run(`sph_${randomUUID().slice(0, 8)}`, cfg.account_id, today, unitPrice, units, value);

  // 5. Sync the account's balance so the rest of the app sees the new value.
  const existingBal = db
    .prepare("SELECT id FROM balances WHERE account_id = ? AND date = ?")
    .get(cfg.account_id, today) as { id: string } | undefined;
  if (existingBal) {
    db.prepare("UPDATE balances SET balance = ?, notes = ? WHERE id = ?").run(
      value,
      "Super valuation (auto)",
      existingBal.id
    );
  } else {
    db.prepare(
      "INSERT INTO balances (id, account_id, date, balance, notes) VALUES (?, ?, ?, ?, ?)"
    ).run(
      `bal_${randomUUID().slice(0, 8)}`,
      cfg.account_id,
      today,
      value,
      "Super valuation (auto)"
    );
  }

  return {
    account_id: cfg.account_id,
    unit_price: unitPrice,
    units,
    value,
    contributed_periods: contributedPeriods,
    contributed_amount: contributedAmount,
  };
}

export function getSuperConfigs(db: Database.Database): SuperConfig[] {
  return db
    .prepare(
      `SELECT sc.*, a.name as account_name, a.owner as owner
       FROM super_config sc JOIN accounts a ON sc.account_id = a.id
       WHERE a.type = 'super'`
    )
    .all() as SuperConfig[];
}

// Refresh every configured super account. Fetches all proxy-basket tickers in
// one batch, then values each account. Safe to call on every net-worth read.
export async function refreshAllSuper(
  db: Database.Database
): Promise<SuperRefreshResult[]> {
  const configs = getSuperConfigs(db);
  if (configs.length === 0) return [];

  // Gather every ticker used by any proxy basket and price them once.
  const tickers = new Set<string>();
  for (const cfg of configs) {
    if (cfg.price_source !== "proxy") continue;
    for (const leg of parseBasket(cfg)) tickers.add(leg.ticker.toUpperCase());
  }

  const pricesNow: Record<string, number> = {};
  if (tickers.size > 0) {
    const quotes = await getQuotes([...tickers]);
    for (const [t, q] of Object.entries(quotes)) {
      pricesNow[t.toUpperCase()] = q.price;
      // Cache the basket price so "Refresh Prices" keeps it fresh and the
      // fallback below can find it when a later fetch fails.
      try {
        upsertQuote(db, t.toUpperCase(), q);
      } catch {
        // non-fatal
      }
    }
    // Fall back to cached prices for any ticker Yahoo didn't return this run.
    for (const t of tickers) {
      if (pricesNow[t]) continue;
      const row = db
        .prepare("SELECT price FROM price_cache WHERE UPPER(ticker) = ?")
        .get(t) as { price: number } | undefined;
      if (row?.price) pricesNow[t] = row.price;
    }
  }

  const results: SuperRefreshResult[] = [];
  for (const cfg of configs) {
    try {
      results.push(await refreshSuperAccount(db, cfg, pricesNow));
    } catch {
      // Skip a bad account rather than failing the whole refresh.
    }
  }
  return results;
}

// Capture anchor prices for a proxy basket right now, so future valuations move
// relative to today. Returns the basket_base JSON to store alongside the anchor
// unit price/date. Used when (re)configuring an account.
export async function captureBasketBase(
  basket: BasketLeg[]
): Promise<Record<string, number>> {
  const tickers = basket.map((l) => l.ticker.toUpperCase());
  const base: Record<string, number> = {};
  if (tickers.length === 0) return base;
  const quotes = await getQuotes(tickers);
  for (const [t, q] of Object.entries(quotes)) base[t.toUpperCase()] = q.price;
  return base;
}
