"use client";

import { useEffect, useState, useCallback } from "react";

interface Transaction {
  id: string;
  account_id: string;
  account_name: string;
  date: string;
  amount: number;
  description: string;
  category: string | null;
  notes: string | null;
}

interface Account {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Proposal {
  id: string;
  date: string;
  amount: number;
  description: string;
  proposed: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD",
    minimumFractionDigits: 2,
  }).format(value);
}

const inputClass = "w-full bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";
const labelClass = "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5";

export default function SpendingPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<string[]>(["summary", "transactions"]);

  // Bulk categorisation with Claude (propose → confirm → apply).
  const [uncat, setUncat] = useState(0);
  const [catConfigured, setCatConfigured] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [catApplying, setCatApplying] = useState(false);
  const [catOverride, setCatOverride] = useState<Record<string, string>>({});
  const [catExcluded, setCatExcluded] = useState<Set<string>>(new Set());
  const [catMsg, setCatMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    account_id: "", date: new Date().toISOString().split("T")[0],
    amount: "", description: "", category: "", notes: "", isExpense: true,
  });

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/transactions").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()).catch(() => []),
    ]).then(([txns, accs, cats]) => {
      setTransactions(txns);
      setAccounts(accs);
      setCategories(cats);
      if (accs.length > 0 && !form.account_id) {
        setForm((f) => ({ ...f, account_id: accs[0].id }));
      }
      setLoading(false);
    });
  }, [form.account_id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/prefs")
      .then((r) => r.json())
      .then((p) => {
        if (Array.isArray(p?.spendingOrder) && p.spendingOrder.length > 0) {
          setSectionOrder(p.spendingOrder);
        }
      })
      .catch(() => {});
  }, []);

  const orderOf = (id: string) => {
    const i = sectionOrder.indexOf(id);
    return i === -1 ? 99 : 10 + i;
  };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const amount = form.isExpense
      ? -Math.abs(parseFloat(form.amount))
      : Math.abs(parseFloat(form.amount));

    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount }),
    });
    setForm({
      account_id: form.account_id,
      date: new Date().toISOString().split("T")[0],
      amount: "", description: "", category: "", notes: "", isExpense: true,
    });
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/transactions?id=${id}`, { method: "DELETE" });
    load();
  }

  const refreshCat = useCallback(() => {
    fetch("/api/agent/categorize")
      .then((r) => r.json())
      .then((d) => {
        setUncat(d.uncategorised || 0);
        setCatConfigured(Boolean(d.configured));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCat();
  }, [refreshCat]);

  async function proposeCats() {
    setCatBusy(true);
    setCatMsg(null);
    try {
      const res = await fetch("/api/agent/categorize", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setCatMsg(data.error || "Couldn't categorise.");
        return;
      }
      setProposals(data.proposals || []);
      setCatOverride({});
      setCatExcluded(new Set());
      if ((data.proposals || []).length === 0) {
        setCatMsg("Nothing uncategorised to work on.");
      }
    } catch {
      setCatMsg("Couldn't reach Claude — check your connection.");
    } finally {
      setCatBusy(false);
    }
  }

  async function applyCats() {
    if (!proposals) return;
    const updates = proposals
      .filter((p) => !catExcluded.has(p.id))
      .map((p) => ({ id: p.id, category: catOverride[p.id] ?? p.proposed }));
    if (updates.length === 0) {
      setProposals(null);
      return;
    }
    setCatApplying(true);
    try {
      const res = await fetch("/api/agent/categorize", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      setCatMsg(`Categorised ${data.updated} transaction${data.updated !== 1 ? "s" : ""}.`);
      setProposals(null);
      load();
      refreshCat();
    } finally {
      setCatApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading...</p>
      </div>
    );
  }

  const totalIncome = transactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
            Spending & Income
          </h1>
          <p className="text-sm text-gbx-muted font-body mt-1">
            Track transactions and categorise spending
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {catConfigured && uncat > 0 && !proposals && (
            <button
              onClick={proposeCats}
              disabled={catBusy}
              className="border border-gbx-teal text-gbx-teal px-4 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-teal hover:text-white transition-colors disabled:opacity-50"
            >
              {catBusy ? "Claude is reading…" : `Categorise ${uncat} with Claude`}
            </button>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
          >
            {showForm ? "Cancel" : "Add Transaction"}
          </button>
        </div>
      </div>

      {catMsg && (
        <p className="text-sm font-body font-medium text-gbx-teal" style={{ order: 0 }}>
          {catMsg}
        </p>
      )}

      {/* Claude's proposed categories — review before applying */}
      {proposals && proposals.length > 0 && (
        <div className="bg-white border border-gbx-border" style={{ order: 2 }}>
          <div className="px-4 sm:px-6 pt-5 pb-3 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.15em] font-body font-medium bg-gbx-teal/10 text-gbx-teal px-2 py-1">
                  Proposed by Claude
                </span>
                <h2 className="text-sm font-body font-medium text-gbx-charcoal">
                  {proposals.length - catExcluded.size} of {proposals.length} to apply
                </h2>
              </div>
              <p className="text-[11px] text-gbx-muted font-body mt-1">
                Review and adjust — nothing is saved until you apply.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setProposals(null)}
                className="px-4 py-2 text-[11px] uppercase tracking-[0.12em] font-body font-medium border border-gbx-border text-gbx-muted hover:text-gbx-charcoal transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyCats}
                disabled={catApplying || proposals.length - catExcluded.size === 0}
                className="px-4 py-2 bg-gbx-teal text-white text-[11px] uppercase tracking-[0.12em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
              >
                {catApplying ? "Applying…" : `Apply ${proposals.length - catExcluded.size}`}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-y border-gbx-border text-[10px] uppercase tracking-[0.12em] text-gbx-muted">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gbx-border/60">
                {proposals.map((p) => {
                  const isExpense = p.amount < 0;
                  const opts = categories.filter((c) =>
                    isExpense ? c.type === "expense" : c.type === "income"
                  );
                  return (
                    <tr key={p.id} className={catExcluded.has(p.id) ? "opacity-40" : ""}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!catExcluded.has(p.id)}
                          onChange={() =>
                            setCatExcluded((s) => {
                              const n = new Set(s);
                              if (n.has(p.id)) n.delete(p.id);
                              else n.add(p.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-data text-xs text-gbx-charcoal whitespace-nowrap">{p.date}</td>
                      <td className="px-3 py-2 text-xs text-gbx-charcoal max-w-[260px] truncate">{p.description}</td>
                      <td className={`px-3 py-2 text-right font-data text-xs whitespace-nowrap ${p.amount >= 0 ? "text-gbx-teal" : "text-red-600"}`}>
                        {p.amount >= 0 ? "+" : ""}{formatCurrency(p.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={catOverride[p.id] ?? p.proposed}
                          onChange={(e) => setCatOverride((c) => ({ ...c, [p.id]: e.target.value }))}
                          className="border border-gbx-border text-xs font-body px-2 py-1 bg-white text-gbx-charcoal"
                        >
                          {opts.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ order: orderOf("summary") }}>
        <div className="bg-white border border-gbx-border p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Income</p>
          <p className="font-data text-xl text-gbx-teal">+{formatCurrency(totalIncome)}</p>
        </div>
        <div className="bg-white border border-gbx-border p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Expenses</p>
          <p className="font-data text-xl text-red-600">-{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="bg-white border border-gbx-border p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Net</p>
          <p className={`font-data text-xl ${totalIncome - totalExpenses >= 0 ? "text-gbx-teal" : "text-red-600"}`}>
            {formatCurrency(totalIncome - totalExpenses)}
          </p>
        </div>
      </div>

      {/* New transaction form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gbx-border p-6 space-y-4" style={{ order: 1 }}>
          <div className="flex gap-4 mb-2">
            <button type="button" onClick={() => setForm({ ...form, isExpense: true })}
              className={`px-4 py-2 text-[11px] uppercase tracking-[0.1em] font-body font-medium transition-colors ${form.isExpense ? "bg-gbx-charcoal text-white" : "bg-gbx-soft text-gbx-muted"}`}>
              Expense
            </button>
            <button type="button" onClick={() => setForm({ ...form, isExpense: false })}
              className={`px-4 py-2 text-[11px] uppercase tracking-[0.1em] font-body font-medium transition-colors ${!form.isExpense ? "bg-gbx-teal text-white" : "bg-gbx-soft text-gbx-muted"}`}>
              Income
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Account</label>
              <select className={inputClass} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div>
              <label className={labelClass}>Amount</label>
              <input type="number" step="0.01" className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required placeholder="0.00" />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="What was this for?" />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Uncategorised</option>
                {categories.filter(c => form.isExpense ? c.type === "expense" : c.type === "income").map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <button type="submit" className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors">
            Add Transaction
          </button>
        </form>
      )}

      {/* Transaction list */}
      <div style={{ order: orderOf("transactions") }}>
      {transactions.length === 0 ? (
        <div className="bg-gbx-soft border border-gbx-border p-12 text-center">
          <p className="text-gbx-muted font-body">No transactions yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gbx-border overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gbx-border">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Date</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Description</th>
                <th className="hidden md:table-cell text-left px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Account</th>
                <th className="hidden sm:table-cell text-left px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Category</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">Amount</th>
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id} className="border-b border-gbx-border/50 hover:bg-gbx-soft/30 transition-colors">
                  <td className="px-4 py-3 font-data text-sm text-gbx-charcoal">{txn.date}</td>
                  <td className="px-4 py-3 text-sm font-body text-gbx-charcoal">{txn.description}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-sm font-body text-gbx-muted">{txn.account_name}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-xs font-body text-gbx-muted">{txn.category || "—"}</td>
                  <td className={`px-4 py-3 text-right font-data text-sm ${txn.amount >= 0 ? "text-gbx-teal" : "text-red-600"}`}>
                    {txn.amount >= 0 ? "+" : ""}{formatCurrency(txn.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(txn.id)} className="text-gbx-muted hover:text-red-500 text-xs transition-colors">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
