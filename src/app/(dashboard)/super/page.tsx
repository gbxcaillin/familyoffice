"use client";

import { useEffect, useState, useCallback } from "react";

interface BasketLeg {
  ticker: string;
  weight: number;
}
interface HistoryPoint {
  date: string;
  unit_price: number;
  units: number;
  value: number;
}
interface SuperAccount {
  account_id: string;
  name: string;
  owner: string;
  fund_name: string | null;
  option_name: string | null;
  price_source: "proxy" | "manual" | "feed";
  unit_price: number | null;
  unit_price_date: string | null;
  units: number | null;
  value: number;
  fee_annual: number | null;
  feed_url: string | null;
  feed_path: string | null;
  contrib_method: "sg" | "fixed" | "none";
  salary: number | null;
  sg_rate: number | null;
  pay_frequency: "weekly" | "fortnightly" | "monthly";
  extra_per_period: number | null;
  contrib_tax: number | null;
  per_period_net: number;
  per_year_net: number;
  fy_contributions_net: number;
  basket: BasketLeg[];
  history: HistoryPoint[];
  day_change_pct: number | null;
}
interface Users {
  person1: string;
  person2: string;
}

const DEFAULT_USERS: Users = { person1: "Person 1", person2: "Person 2" };

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";
const labelClass =
  "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5";
const btnPrimary =
  "bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50";

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}
function fmtCurrency2(v: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(v);
}

const SOURCE_LABEL: Record<string, string> = {
  proxy: "Index proxy",
  manual: "Manual",
  feed: "Live feed",
};
const FREQ_LABEL: Record<string, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
};

// Minimal dependency-free sparkline of the super value over time.
function Sparkline({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 240;
  const h = 44;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.value - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full h-11">
      <path
        d={d}
        fill="none"
        stroke={up ? "#2E8B6E" : "#C44E52"}
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface FormState {
  name: string;
  owner: string;
  fund_name: string;
  option_name: string;
  price_source: "proxy" | "manual" | "feed";
  balance: string;
  unit_price: string;
  fee_annual: string;
  contrib_method: "sg" | "fixed" | "none";
  salary: string;
  sg_rate: string;
  pay_frequency: "weekly" | "fortnightly" | "monthly";
  extra_per_period: string;
  contrib_tax: string;
  feed_url: string;
  feed_path: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  owner: "person2",
  fund_name: "Australian Retirement Trust",
  option_name: "High Growth Index",
  price_source: "proxy",
  balance: "",
  unit_price: "",
  fee_annual: "0.10",
  contrib_method: "sg",
  salary: "",
  sg_rate: "12",
  pay_frequency: "fortnightly",
  extra_per_period: "",
  contrib_tax: "15",
  feed_url: "",
  feed_path: "",
};

export default function SuperPage() {
  const [accounts, setAccounts] = useState<SuperAccount[]>([]);
  const [users, setUsers] = useState<Users>(DEFAULT_USERS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(() => {
    fetch("/api/super")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => {});
  }, [load]);

  const ownerLabel = (o: string) =>
    o === "joint" ? "Joint" : o === "person1" ? users.person1 : users.person2;

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(a: SuperAccount) {
    setEditId(a.account_id);
    setForm({
      name: a.name,
      owner: a.owner,
      fund_name: a.fund_name || "",
      option_name: a.option_name || "",
      price_source: a.price_source,
      balance: a.value ? a.value.toFixed(2) : "",
      unit_price: a.unit_price != null ? String(a.unit_price) : "",
      fee_annual: a.fee_annual != null ? (a.fee_annual * 100).toString() : "0.10",
      contrib_method: a.contrib_method,
      salary: a.salary != null ? String(a.salary) : "",
      sg_rate: a.sg_rate != null ? (a.sg_rate * 100).toString() : "12",
      pay_frequency: a.pay_frequency,
      extra_per_period: a.extra_per_period ? String(a.extra_per_period) : "",
      contrib_tax: a.contrib_tax != null ? (a.contrib_tax * 100).toString() : "15",
      feed_url: a.feed_url || "",
      feed_path: a.feed_path || "",
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      account_id: editId || undefined,
      name: form.name,
      owner: form.owner,
      fund_name: form.fund_name,
      option_name: form.option_name,
      price_source: form.price_source,
      balance: form.balance,
      unit_price: form.unit_price,
      fee_annual: form.fee_annual !== "" ? parseFloat(form.fee_annual) / 100 : "",
      contrib_method: form.contrib_method,
      salary: form.salary,
      sg_rate: form.sg_rate !== "" ? parseFloat(form.sg_rate) / 100 : "",
      pay_frequency: form.pay_frequency,
      extra_per_period: form.extra_per_period,
      contrib_tax: form.contrib_tax !== "" ? parseFloat(form.contrib_tax) / 100 : "",
      feed_url: form.feed_url,
      feed_path: form.feed_path,
    };
    await fetch("/api/super", {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setShowForm(false);
    setBusy(false);
    load();
  }

  async function refresh() {
    setBusy(true);
    await fetch("/api/super/refresh", { method: "POST" });
    setBusy(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this super account and all its data?")) return;
    await fetch(`/api/super?account_id=${id}`, { method: "DELETE" });
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
            Superannuation
          </h1>
          <p className="text-sm text-gbx-muted font-body mt-1">
            Tracks unit price and estimated contributions — no manual balance updates
          </p>
        </div>
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <button onClick={refresh} disabled={busy} className="text-[11px] text-gbx-muted hover:text-gbx-teal uppercase tracking-[0.12em] font-body transition-colors disabled:opacity-50">
              {busy ? "Refreshing…" : "Refresh now"}
            </button>
          )}
          <button onClick={showForm ? () => setShowForm(false) : openAdd} className={btnPrimary}>
            {showForm ? "Cancel" : "Add Super Account"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white border border-gbx-border p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Account Name</label>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kirra Super" required />
            </div>
            <div>
              <label className={labelClass}>Owner</label>
              <select className={inputClass} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                <option value="person1">{users.person1}</option>
                <option value="person2">{users.person2}</option>
                <option value="joint">Joint</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Fund</label>
              <input className={inputClass} value={form.fund_name} onChange={(e) => setForm({ ...form, fund_name: e.target.value })} placeholder="e.g. Australian Retirement Trust" />
            </div>
            <div>
              <label className={labelClass}>Investment Option</label>
              <input className={inputClass} value={form.option_name} onChange={(e) => setForm({ ...form, option_name: e.target.value })} placeholder="e.g. High Growth Index" />
            </div>
            <div>
              <label className={labelClass}>Current Balance (AUD)</label>
              <input type="number" step="0.01" className={inputClass} value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} placeholder="from latest statement" />
            </div>
            <div>
              <label className={labelClass}>Unit Price (optional)</label>
              <input type="number" step="0.0001" className={inputClass} value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="from fund site — makes units match statements" />
            </div>
          </div>

          <div className="border-t border-gbx-border pt-4">
            <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-charcoal mb-3">Value Source</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>How to track value</label>
                <select className={inputClass} value={form.price_source} onChange={(e) => setForm({ ...form, price_source: e.target.value as FormState["price_source"] })}>
                  <option value="proxy">Index proxy (automatic)</option>
                  <option value="manual">Manual unit price</option>
                  <option value="feed">Live JSON feed</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Annual Fee %</label>
                <input type="number" step="0.01" className={inputClass} value={form.fee_annual} onChange={(e) => setForm({ ...form, fee_annual: e.target.value })} placeholder="0.10" />
              </div>
              {form.price_source === "feed" && (
                <>
                  <div>
                    <label className={labelClass}>Feed URL</label>
                    <input className={inputClass} value={form.feed_url} onChange={(e) => setForm({ ...form, feed_url: e.target.value })} placeholder="https://…/prices.json" />
                  </div>
                  <div>
                    <label className={labelClass}>JSON Path to price</label>
                    <input className={inputClass} value={form.feed_path} onChange={(e) => setForm({ ...form, feed_path: e.target.value })} placeholder="e.g. data.0.unitPrice" />
                  </div>
                </>
              )}
            </div>
            {form.price_source === "proxy" && (
              <p className="text-[11px] text-gbx-muted font-body mt-2">
                Indexed options are tracked with a basket of AUD index ETFs (VAS / VGS / VAF for a High Growth Index option), anchored to today&apos;s balance and moved daily.
              </p>
            )}
          </div>

          <div className="border-t border-gbx-border pt-4">
            <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-charcoal mb-3">Contributions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Method</label>
                <select className={inputClass} value={form.contrib_method} onChange={(e) => setForm({ ...form, contrib_method: e.target.value as FormState["contrib_method"] })}>
                  <option value="sg">SG % of salary</option>
                  <option value="fixed">Fixed $ per pay</option>
                  <option value="none">Don&apos;t estimate</option>
                </select>
              </div>
              {form.contrib_method === "sg" && (
                <>
                  <div>
                    <label className={labelClass}>Gross Salary (AUD/yr)</label>
                    <input type="number" step="0.01" className={inputClass} value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="e.g. 95000" />
                  </div>
                  <div>
                    <label className={labelClass}>SG Rate %</label>
                    <input type="number" step="0.1" className={inputClass} value={form.sg_rate} onChange={(e) => setForm({ ...form, sg_rate: e.target.value })} placeholder="12" />
                  </div>
                </>
              )}
              {form.contrib_method !== "none" && (
                <>
                  <div>
                    <label className={labelClass}>Pay Frequency</label>
                    <select className={inputClass} value={form.pay_frequency} onChange={(e) => setForm({ ...form, pay_frequency: e.target.value as FormState["pay_frequency"] })}>
                      <option value="weekly">Weekly</option>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Extra / Salary Sacrifice ($ per pay)</label>
                    <input type="number" step="0.01" className={inputClass} value={form.extra_per_period} onChange={(e) => setForm({ ...form, extra_per_period: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className={labelClass}>Contributions Tax %</label>
                    <input type="number" step="0.1" className={inputClass} value={form.contrib_tax} onChange={(e) => setForm({ ...form, contrib_tax: e.target.value })} placeholder="15" />
                  </div>
                </>
              )}
            </div>
          </div>

          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "Saving…" : editId ? "Save Changes" : "Create Super Account"}
          </button>
        </form>
      )}

      {accounts.length === 0 && !showForm ? (
        <div className="bg-gbx-soft border border-gbx-border p-12 text-center">
          <p className="text-gbx-muted font-body">No super accounts yet. Add one to track its value and contributions automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {accounts.map((a) => {
            const growth =
              a.history.length >= 2
                ? a.history[a.history.length - 1].value - a.history[0].value
                : 0;
            return (
              <div key={a.account_id} className="bg-white border border-gbx-border p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-body font-medium text-gbx-charcoal">{a.name}</h3>
                    <p className="text-[10px] uppercase tracking-[0.15em] text-gbx-muted font-body mt-0.5">
                      {[a.fund_name, a.option_name].filter(Boolean).join(" · ") || "Super"} · {ownerLabel(a.owner)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[9px] uppercase tracking-[0.12em] text-gbx-teal border border-gbx-teal/40 px-2 py-1 font-body">
                      {SOURCE_LABEL[a.price_source]}
                    </span>
                    <button onClick={() => openEdit(a)} className="text-[11px] text-gbx-muted hover:text-gbx-teal uppercase tracking-[0.1em] font-body transition-colors">Edit</button>
                    <button onClick={() => remove(a.account_id)} className="text-gbx-muted hover:text-red-500 text-sm transition-colors" title="Delete">×</button>
                  </div>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="font-heading text-3xl font-light text-gbx-charcoal tabular-nums">
                      {fmtCurrency(a.value)}
                    </p>
                    {a.day_change_pct != null && (
                      <p className={`text-xs font-body mt-1 ${a.day_change_pct >= 0 ? "text-gbx-teal" : "text-red-500"}`}>
                        {a.day_change_pct >= 0 ? "▲" : "▼"} {Math.abs(a.day_change_pct).toFixed(2)}% today
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <Sparkline points={a.history} />
                    {a.history.length >= 2 && (
                      <p className={`text-[11px] font-body ${growth >= 0 ? "text-gbx-teal" : "text-red-500"}`}>
                        {growth >= 0 ? "+" : ""}{fmtCurrency(growth)} since tracking
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-gbx-border pt-4 text-sm font-body">
                  <div className="flex justify-between">
                    <span className="text-gbx-muted">Units</span>
                    <span className="text-gbx-charcoal tabular-nums">{(a.units ?? 0).toLocaleString("en-AU", { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gbx-muted">Unit price</span>
                    <span className="text-gbx-charcoal tabular-nums">{a.unit_price != null ? fmtCurrency2(a.unit_price) : "—"}</span>
                  </div>
                  {a.contrib_method !== "none" && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gbx-muted">Per {a.pay_frequency === "monthly" ? "month" : a.pay_frequency === "weekly" ? "week" : "fortnight"}</span>
                        <span className="text-gbx-charcoal tabular-nums">{fmtCurrency2(a.per_period_net)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gbx-muted">Est. / year</span>
                        <span className="text-gbx-charcoal tabular-nums">{fmtCurrency(a.per_year_net)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gbx-muted">This FY so far</span>
                        <span className="text-gbx-charcoal tabular-nums">{fmtCurrency(a.fy_contributions_net)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gbx-muted">As at</span>
                    <span className="text-gbx-charcoal tabular-nums">{a.unit_price_date || "—"}</span>
                  </div>
                </div>

                {a.contrib_method === "sg" && a.salary ? (
                  <p className="text-[11px] text-gbx-muted font-body">
                    {FREQ_LABEL[a.pay_frequency]} SG at {((a.sg_rate ?? 0.12) * 100).toFixed(1)}% of {fmtCurrency(a.salary)}, net of {((a.contrib_tax ?? 0.15) * 100).toFixed(0)}% contributions tax{a.extra_per_period ? `, plus ${fmtCurrency2(a.extra_per_period)} extra per pay` : ""}.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
