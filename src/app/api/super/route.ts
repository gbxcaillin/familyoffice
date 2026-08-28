import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { randomUUID } from "crypto";
import {
  refreshAllSuper,
  getSuperConfigs,
  estimatePerPeriodNet,
  payPeriodsPerYear,
  captureBasketBase,
  DEFAULT_HIGH_GROWTH_INDEX_BASKET,
  type BasketLeg,
  type SuperConfig,
  type PayFrequency,
} from "@/lib/super";

interface HistoryRow {
  date: string;
  unit_price: number;
  units: number;
  value: number;
}

// Financial-year start (Australian FY: 1 July). Used to estimate contributions
// made so far this year.
function fyStartISO(today: Date): string {
  const y = today.getUTCFullYear();
  const july = new Date(Date.UTC(y, 6, 1)); // month 6 = July
  const start = today >= july ? july : new Date(Date.UTC(y - 1, 6, 1));
  return start.toISOString().slice(0, 10);
}

function periodsBetween(fromISO: string, toISO: string, freq: PayFrequency): number {
  const perYear = payPeriodsPerYear(freq);
  const days = Math.max(
    0,
    (new Date(toISO + "T00:00:00Z").getTime() -
      new Date(fromISO + "T00:00:00Z").getTime()) /
      (24 * 60 * 60 * 1000)
  );
  return Math.floor((days / 365.25) * perYear);
}

function parseBasket(json: string | null): BasketLeg[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const db = getDb();
  await refreshAllSuper(db);
  const configs = getSuperConfigs(db);
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const fyStart = fyStartISO(today);

  const accounts = configs.map((cfg) => {
    const perPeriodNet = estimatePerPeriodNet(cfg);
    const perYear = payPeriodsPerYear(cfg.pay_frequency);
    const anchor = cfg.unit_price_date || fyStart;
    const contribFrom = anchor > fyStart ? anchor : fyStart;
    const fyPeriods =
      cfg.contrib_method === "none"
        ? 0
        : periodsBetween(contribFrom, todayISO, cfg.pay_frequency);

    const history = db
      .prepare(
        `SELECT date, unit_price, units, value FROM super_price_history
         WHERE account_id = ? ORDER BY date ASC`
      )
      .all(cfg.account_id) as HistoryRow[];

    let dayChangePct: number | null = null;
    if (history.length >= 2) {
      const a = history[history.length - 2].unit_price;
      const b = history[history.length - 1].unit_price;
      if (a > 0) dayChangePct = ((b - a) / a) * 100;
    }

    const value = (cfg.units ?? 0) * (cfg.unit_price ?? 0);

    return {
      account_id: cfg.account_id,
      name: cfg.account_name,
      owner: cfg.owner,
      fund_name: cfg.fund_name,
      option_name: cfg.option_name,
      price_source: cfg.price_source,
      unit_price: cfg.unit_price,
      unit_price_date: cfg.unit_price_date,
      units: cfg.units,
      value,
      fee_annual: cfg.fee_annual,
      feed_url: cfg.feed_url,
      feed_path: cfg.feed_path,
      contrib_method: cfg.contrib_method,
      salary: cfg.salary,
      sg_rate: cfg.sg_rate,
      pay_frequency: cfg.pay_frequency,
      extra_per_period: cfg.extra_per_period,
      contrib_tax: cfg.contrib_tax,
      per_period_net: perPeriodNet,
      per_year_net: perPeriodNet * perYear,
      fy_contributions_net: perPeriodNet * fyPeriods,
      basket: parseBasket(cfg.basket),
      history,
      day_change_pct: dayChangePct,
    };
  });

  return NextResponse.json({ accounts });
}

// Create a super account together with its configuration.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    name,
    owner,
    fund_name,
    option_name,
    institution,
    price_source = "proxy",
    balance,
    unit_price,
    fee_annual,
    contrib_method = "sg",
    salary,
    sg_rate,
    pay_frequency = "fortnightly",
    extra_per_period,
    contrib_tax,
    basket,
    feed_url,
    feed_path,
  } = body;

  if (!name || !owner) {
    return NextResponse.json({ error: "name and owner required" }, { status: 400 });
  }

  const db = getDb();
  const id = `acc_${randomUUID().slice(0, 8)}`;
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(
    "INSERT INTO accounts (id, name, type, owner, institution, currency) VALUES (?, ?, 'super', ?, ?, 'AUD')"
  ).run(id, name, owner, institution || fund_name || null);

  // Anchor the valuation: units = balance / unit_price at today's date. If no
  // unit price is given, anchor the price at 1 so units equal the dollar
  // balance and future proxy movement scales it from here.
  const bal = balance !== undefined && balance !== null && balance !== "" ? parseFloat(balance) : 0;
  const anchorPrice =
    unit_price !== undefined && unit_price !== null && unit_price !== ""
      ? parseFloat(unit_price)
      : 1;
  const units = anchorPrice > 0 ? bal / anchorPrice : 0;

  const legs: BasketLeg[] =
    Array.isArray(basket) && basket.length > 0
      ? basket
      : price_source === "proxy"
        ? DEFAULT_HIGH_GROWTH_INDEX_BASKET
        : [];

  // Snapshot the basket's current prices so proxy valuations move relative to
  // today (the anchor moment).
  let basketBase: Record<string, number> = {};
  if (price_source === "proxy" && legs.length > 0) {
    try {
      basketBase = await captureBasketBase(legs);
    } catch {
      // Leave empty; the refresh will fall back to the last known unit price.
    }
  }

  db.prepare(
    `INSERT INTO super_config
       (account_id, fund_name, option_name, price_source, unit_price, unit_price_date,
        units, fee_annual, basket, basket_base, feed_url, feed_path,
        contrib_method, salary, sg_rate, extra_per_period, pay_frequency, contrib_tax,
        last_contrib_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    fund_name || null,
    option_name || null,
    price_source,
    anchorPrice,
    today,
    units,
    fee_annual !== undefined && fee_annual !== null && fee_annual !== ""
      ? parseFloat(fee_annual)
      : 0.001,
    legs.length > 0 ? JSON.stringify(legs) : null,
    Object.keys(basketBase).length > 0 ? JSON.stringify(basketBase) : null,
    feed_url || null,
    feed_path || null,
    contrib_method,
    salary !== undefined && salary !== null && salary !== "" ? parseFloat(salary) : null,
    sg_rate !== undefined && sg_rate !== null && sg_rate !== "" ? parseFloat(sg_rate) : 0.12,
    extra_per_period !== undefined && extra_per_period !== null && extra_per_period !== ""
      ? parseFloat(extra_per_period)
      : 0,
    pay_frequency,
    contrib_tax !== undefined && contrib_tax !== null && contrib_tax !== ""
      ? parseFloat(contrib_tax)
      : 0.15,
    today
  );

  // Seed today's balance immediately so the account has a value before the
  // first refresh cycle runs.
  db.prepare(
    "INSERT INTO balances (id, account_id, date, balance, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(`bal_${randomUUID().slice(0, 8)}`, id, today, units * anchorPrice, "Super valuation (auto)");

  await refreshAllSuper(db);
  return NextResponse.json({ account_id: id }, { status: 201 });
}

// Update an existing super account's configuration. Only supplied fields
// change. Re-anchors the proxy basket when the price source, basket, or anchor
// price/balance changes so future movement is measured from now.
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { account_id } = body;
  if (!account_id) {
    return NextResponse.json({ error: "account_id required" }, { status: 400 });
  }

  const db = getDb();
  const cfg = db
    .prepare("SELECT * FROM super_config WHERE account_id = ?")
    .get(account_id) as SuperConfig | undefined;
  if (!cfg) {
    return NextResponse.json({ error: "Super config not found" }, { status: 404 });
  }

  // Optionally rename the account.
  if (typeof body.name === "string" && body.name.trim()) {
    db.prepare("UPDATE accounts SET name = ?, updated_at = datetime('now') WHERE id = ?").run(
      body.name.trim(),
      account_id
    );
  }
  if (typeof body.owner === "string" && body.owner) {
    db.prepare("UPDATE accounts SET owner = ? WHERE id = ?").run(body.owner, account_id);
  }

  const num = (v: unknown, fallback: number | null): number | null =>
    v !== undefined && v !== null && v !== "" ? parseFloat(v as string) : fallback;

  const today = new Date().toISOString().slice(0, 10);
  const priceSource = (body.price_source as string) ?? cfg.price_source;

  // Determine the new anchor. If a balance and/or unit price is supplied we
  // re-anchor units and the anchor date to today.
  let unitPrice = cfg.unit_price ?? 1;
  let units = cfg.units ?? 0;
  let unitPriceDate = cfg.unit_price_date ?? today;
  let lastContrib = cfg.last_contrib_date ?? cfg.unit_price_date ?? today;
  const reanchor =
    body.balance !== undefined ||
    body.unit_price !== undefined ||
    (body.price_source !== undefined && body.price_source !== cfg.price_source) ||
    body.basket !== undefined;

  if (reanchor) {
    unitPrice = num(body.unit_price, cfg.unit_price ?? 1) ?? 1;
    const bal = num(body.balance, (cfg.units ?? 0) * (cfg.unit_price ?? 1)) ?? 0;
    units = unitPrice > 0 ? bal / unitPrice : 0;
    unitPriceDate = today;
    lastContrib = today; // avoid double-counting past contributions after re-anchor
  }

  const legs: BasketLeg[] = Array.isArray(body.basket)
    ? (body.basket as BasketLeg[])
    : cfg.basket
      ? JSON.parse(cfg.basket)
      : priceSource === "proxy"
        ? DEFAULT_HIGH_GROWTH_INDEX_BASKET
        : [];

  let basketBaseJson = cfg.basket_base;
  if (reanchor && priceSource === "proxy" && legs.length > 0) {
    try {
      const base = await captureBasketBase(legs);
      if (Object.keys(base).length > 0) basketBaseJson = JSON.stringify(base);
    } catch {
      // keep existing base
    }
  }

  db.prepare(
    `UPDATE super_config SET
       fund_name = ?, option_name = ?, price_source = ?, unit_price = ?, unit_price_date = ?,
       units = ?, fee_annual = ?, basket = ?, basket_base = ?, feed_url = ?, feed_path = ?,
       contrib_method = ?, salary = ?, sg_rate = ?, extra_per_period = ?, pay_frequency = ?,
       contrib_tax = ?, last_contrib_date = ?, updated_at = datetime('now')
     WHERE account_id = ?`
  ).run(
    body.fund_name !== undefined ? body.fund_name || null : cfg.fund_name,
    body.option_name !== undefined ? body.option_name || null : cfg.option_name,
    priceSource,
    unitPrice,
    unitPriceDate,
    units,
    num(body.fee_annual, cfg.fee_annual),
    legs.length > 0 ? JSON.stringify(legs) : null,
    basketBaseJson,
    body.feed_url !== undefined ? body.feed_url || null : cfg.feed_url,
    body.feed_path !== undefined ? body.feed_path || null : cfg.feed_path,
    (body.contrib_method as string) ?? cfg.contrib_method,
    num(body.salary, cfg.salary),
    num(body.sg_rate, cfg.sg_rate),
    num(body.extra_per_period, cfg.extra_per_period),
    (body.pay_frequency as string) ?? cfg.pay_frequency,
    num(body.contrib_tax, cfg.contrib_tax),
    lastContrib,
    account_id
  );

  await refreshAllSuper(db);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("account_id") || searchParams.get("id");
  if (!id) return NextResponse.json({ error: "account_id required" }, { status: 400 });
  const db = getDb();
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id); // cascades to super_config
  return NextResponse.json({ ok: true });
}
