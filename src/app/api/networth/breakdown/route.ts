import { NextResponse } from "next/server";
import getDb from "@/lib/db";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  owner: string;
  latest_balance: number | null;
}
interface HoldingRow {
  ticker: string;
  display_name: string | null;
  account_name: string;
  account_owner: string;
  effective_pct_p1: number;
  market_value: number | null;
}

export interface LineItem {
  label: string;
  sub: string;
  value: number;
  kind: "account" | "holding";
}

const TYPE_LABELS: Record<string, string> = {
  bank: "Bank",
  brokerage: "Brokerage cash",
  super: "Super",
  property: "Property",
  crypto: "Crypto cash",
  loan: "Loan",
  other: "Other",
};

// Returns the exact accounts and holdings that sum into each owner bucket, so
// the dashboard cards can be expanded to show their working.
export async function GET() {
  const db = getDb();

  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.type, a.owner,
        (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as latest_balance
       FROM accounts a`
    )
    .all() as AccountRow[];

  const holdings = db
    .prepare(
      `SELECT UPPER(h.ticker) as ticker,
        COALESCE(pc.name, h.name, h.ticker) as display_name,
        a.name as account_name,
        a.owner as account_owner,
        COALESCE(
          h.pct_p1,
          CASE a.owner WHEN 'person1' THEN 100 WHEN 'person2' THEN 0 ELSE 50 END
        ) as effective_pct_p1,
        h.units * pc.price as market_value
       FROM holdings h
       JOIN accounts a ON h.account_id = a.id
       LEFT JOIN price_cache pc ON UPPER(h.ticker) = UPPER(pc.ticker)
       WHERE pc.price IS NOT NULL`
    )
    .all() as HoldingRow[];

  const buckets: Record<"person1" | "person2" | "joint", LineItem[]> = {
    person1: [],
    person2: [],
    joint: [],
  };

  for (const a of accounts) {
    const bal = a.latest_balance || 0;
    if (bal === 0) continue;
    const bucket = (a.owner as "person1" | "person2" | "joint") || "joint";
    buckets[bucket].push({
      label: a.name,
      sub: TYPE_LABELS[a.type] || a.type,
      value: bal,
      kind: "account",
    });
  }

  for (const h of holdings) {
    const mv = h.market_value || 0;
    if (mv === 0) continue;
    const p1 = Math.max(0, Math.min(100, h.effective_pct_p1)) / 100;
    if (p1 > 0) {
      buckets.person1.push({
        label: h.ticker,
        sub: `${h.account_name}${p1 < 1 ? ` · ${Math.round(p1 * 100)}%` : ""}`,
        value: mv * p1,
        kind: "holding",
      });
    }
    if (p1 < 1) {
      buckets.person2.push({
        label: h.ticker,
        sub: `${h.account_name}${p1 > 0 ? ` · ${Math.round((1 - p1) * 100)}%` : ""}`,
        value: mv * (1 - p1),
        kind: "holding",
      });
    }
  }

  const sortDesc = (items: LineItem[]) =>
    items.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const result = {
    person1: {
      items: sortDesc(buckets.person1),
      total: buckets.person1.reduce((s, i) => s + i.value, 0),
    },
    person2: {
      items: sortDesc(buckets.person2),
      total: buckets.person2.reduce((s, i) => s + i.value, 0),
    },
    joint: {
      items: sortDesc(buckets.joint),
      total: buckets.joint.reduce((s, i) => s + i.value, 0),
    },
  };

  // "Total" view lists everything, most valuable first.
  const all = sortDesc([
    ...buckets.person1,
    ...buckets.person2,
    ...buckets.joint,
  ]);

  return NextResponse.json({ ...result, total: { items: all, total: all.reduce((s, i) => s + i.value, 0) } });
}
