"use client";

import { useEffect, useState, useCallback } from "react";
import InfoTip from "@/components/InfoTip";

interface Line {
  id: string;
  category: string;
  monthly: number;
  essential: boolean;
  actualThisMonth: number;
}
interface Category {
  name: string;
  color: string;
}

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "teal" | "red"; sub?: string }) {
  return (
    <div className="bg-white border border-gbx-border p-4">
      <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1">{label}</p>
      <p className={`font-data text-xl ${tone === "teal" ? "text-gbx-teal" : tone === "red" ? "text-red-500" : "text-gbx-charcoal"}`}>{value}</p>
      {sub && <p className="text-[11px] text-gbx-muted font-body mt-0.5">{sub}</p>}
    </div>
  );
}

export default function BudgetPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [order, setOrder] = useState<string[]>([]); // display order, re-sorted on blur/toggle
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [newAmt, setNewAmt] = useState("");
  const [newEssential, setNewEssential] = useState(true);

  // Essentials first (highest monthly → lowest), then discretionary (same).
  const sortedIds = (ls: Line[]): string[] =>
    [...ls]
      .sort((a, b) => (a.essential !== b.essential ? (a.essential ? -1 : 1) : b.monthly - a.monthly))
      .map((l) => l.id);
  const resort = (ls: Line[]) => setOrder(sortedIds(ls));

  const load = useCallback(() => {
    fetch("/api/budget")
      .then((r) => r.json())
      .then((d) => {
        setLines(d.lines || []);
        setOrder(
          [...(d.lines || [])]
            .sort((a: Line, b: Line) => (a.essential !== b.essential ? (a.essential ? -1 : 1) : b.monthly - a.monthly))
            .map((l: Line) => l.id)
        );
        setCategories(d.categories || []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function patchLocal(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  async function persist(id: string, patch: Partial<Line>) {
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    await fetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...line, ...patch }),
    });
  }

  async function addLine() {
    if (!newCat.trim()) return;
    await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: newCat.trim(), monthly: newAmt || 0, essential: newEssential }),
    });
    setNewCat("");
    setNewAmt("");
    setNewEssential(true);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/budget?id=${id}`, { method: "DELETE" });
    setLines((ls) => ls.filter((l) => l.id !== id));
    setOrder((o) => o.filter((x) => x !== id));
  }

  // Rows in display order, with any not-yet-ordered lines appended.
  const displayLines: Line[] = [
    ...order.map((id) => lines.find((l) => l.id === id)).filter((l): l is Line => !!l),
    ...lines.filter((l) => !order.includes(l.id)),
  ];

  // Live totals from local state.
  const monthly = lines.reduce((s, l) => s + (l.monthly || 0), 0);
  const essentialMonthly = lines.filter((l) => l.essential).reduce((s, l) => s + (l.monthly || 0), 0);
  const discretionaryMonthly = monthly - essentialMonthly;
  const actual = lines.reduce((s, l) => s + (l.actualThisMonth || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal">Budget</h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          Plan your monthly spending by category, split essential vs discretionary — actuals fill in
          from transactions as they land
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Monthly budget" value={fmt0(monthly)} />
        <Stat label="Annual budget" value={fmt0(monthly * 12)} tone="teal" />
        <Stat label="Essential / mo" value={fmt0(essentialMonthly)} sub={monthly > 0 ? `${Math.round((essentialMonthly / monthly) * 100)}% of budget` : undefined} />
        <Stat label="Discretionary / mo" value={fmt0(discretionaryMonthly)} sub={monthly > 0 ? `${Math.round((discretionaryMonthly / monthly) * 100)}% of budget` : undefined} />
        <Stat
          label="Actual this month"
          value={fmt0(actual)}
          tone={actual > monthly && monthly > 0 ? "red" : undefined}
          sub={monthly > 0 ? `vs ${fmt0(monthly)} budget` : undefined}
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gbx-border overflow-x-auto">
        <table className="w-full text-sm font-body min-w-[640px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-gbx-muted border-b border-gbx-border">
              <th className="text-left font-medium p-3">Category</th>
              <th className="text-center font-medium p-3">
                <span className="inline-flex items-center gap-1">
                  Essential
                  <InfoTip label="Essential vs discretionary">
                    <p>
                      Mark the must-pay lines (mortgage, food, utilities, insurance) as essential and
                      the nice-to-haves (dining, travel, subscriptions) as discretionary. The summary
                      shows your &ldquo;lean&rdquo; essential-only spend — useful for stress tests and
                      cutting back.
                    </p>
                  </InfoTip>
                </span>
              </th>
              <th className="text-right font-medium p-3">Monthly</th>
              <th className="text-right font-medium p-3">Annual</th>
              <th className="text-right font-medium p-3">Actual (mth)</th>
              <th className="text-right font-medium p-3">Remaining</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gbx-border/60">
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gbx-muted font-body">
                  No budget lines yet — add your first category below.
                </td>
              </tr>
            )}
            {displayLines.map((l) => {
              const remaining = l.monthly - l.actualThisMonth;
              const over = l.actualThisMonth > l.monthly && l.monthly > 0;
              return (
                <tr key={l.id}>
                  <td className="p-2">
                    <input
                      className={inputClass}
                      list="budget-cats"
                      value={l.category}
                      onChange={(e) => patchLocal(l.id, { category: e.target.value })}
                      onBlur={(e) => persist(l.id, { category: e.target.value })}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={l.essential}
                      onChange={(e) => {
                        const next = lines.map((x) => (x.id === l.id ? { ...x, essential: e.target.checked } : x));
                        setLines(next);
                        resort(next);
                        persist(l.id, { essential: e.target.checked });
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gbx-muted font-data">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        className="w-24 text-right bg-white border border-gbx-border px-2 py-2 text-sm font-data text-gbx-charcoal tabular-nums focus:outline-none focus:border-gbx-teal"
                        value={l.monthly === 0 ? "" : l.monthly}
                        onChange={(e) => patchLocal(l.id, { monthly: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
                          const next = lines.map((x) => (x.id === l.id ? { ...x, monthly: v } : x));
                          setLines(next);
                          resort(next);
                          persist(l.id, { monthly: v });
                        }}
                      />
                    </div>
                  </td>
                  <td className="p-3 text-right font-data text-gbx-muted tabular-nums">{fmt0(l.monthly * 12)}</td>
                  <td className="p-3 text-right font-data tabular-nums text-gbx-charcoal">
                    {l.actualThisMonth > 0 ? fmt0(l.actualThisMonth) : "—"}
                  </td>
                  <td className={`p-3 text-right font-data tabular-nums ${over ? "text-red-500" : "text-gbx-charcoal"}`}>
                    {l.actualThisMonth > 0 ? `${remaining < 0 ? "−" : ""}${fmt0(Math.abs(remaining))}` : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => remove(l.id)} className="text-gbx-muted hover:text-red-500 transition-colors" title="Delete">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gbx-border font-medium">
              <td className="p-3 text-gbx-charcoal">Total</td>
              <td></td>
              <td className="p-3 text-right font-data text-gbx-charcoal tabular-nums">{fmt0(monthly)}</td>
              <td className="p-3 text-right font-data text-gbx-teal tabular-nums">{fmt0(monthly * 12)}</td>
              <td className="p-3 text-right font-data text-gbx-charcoal tabular-nums">{actual > 0 ? fmt0(actual) : "—"}</td>
              <td className="p-3 text-right font-data text-gbx-charcoal tabular-nums">{actual > 0 ? fmt0(monthly - actual) : "—"}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="budget-cats">
        {categories.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>

      {/* Add line */}
      <div className="bg-gbx-soft border border-gbx-border p-4">
        <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-3">Add a line</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body mb-1">Category</label>
            <input className={inputClass} list="budget-cats" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Groceries" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.12em] text-gbx-muted font-body mb-1">Monthly $</label>
            <input type="number" inputMode="decimal" className="w-32 bg-white border border-gbx-border px-3 py-2 text-sm font-data text-gbx-charcoal focus:outline-none focus:border-gbx-teal" value={newAmt} onChange={(e) => setNewAmt(e.target.value)} placeholder="0" />
          </div>
          <label className="flex items-center gap-2 text-xs text-gbx-muted font-body pb-2">
            <input type="checkbox" checked={newEssential} onChange={(e) => setNewEssential(e.target.checked)} />
            Essential
          </label>
          <button onClick={addLine} disabled={!newCat.trim()} className="bg-gbx-teal text-white px-5 py-2 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50">
            Add
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gbx-muted font-body">
        &ldquo;Actual&rdquo; and &ldquo;Remaining&rdquo; compare against this calendar month&apos;s
        transactions per category — they show &ldquo;—&rdquo; until transactions are logged. The budget
        is independent of the FIRE spend figure (set that on the FIRE tab).
      </p>
    </div>
  );
}
