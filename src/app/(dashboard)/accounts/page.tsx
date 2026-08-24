"use client";

import { useEffect, useState, useCallback } from "react";

interface Account {
  id: string;
  name: string;
  type: string;
  owner: string;
  institution: string | null;
  currency: string;
  notes: string | null;
  latest_balance: number | null;
  latest_balance_date: string | null;
  holdings_value: number | null;
}

interface Users {
  person1: string;
  person2: string;
}

const TYPES = [
  { value: "bank", label: "Bank Account" },
  { value: "brokerage", label: "Brokerage" },
  { value: "super", label: "Superannuation" },
  { value: "property", label: "Property" },
  { value: "crypto", label: "Crypto" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "other", label: "Other" },
];

const DEFAULT_USERS: Users = { person1: "Person 1", person2: "Person 2" };

const TYPE_LABELS: Record<string, string> = {
  bank: "Bank", brokerage: "Brokerage", super: "Super",
  property: "Property", crypto: "Crypto", loan: "Loan", other: "Other",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD",
    minimumFractionDigits: 2,
  }).format(value);
}

const inputClass = "w-full bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";
const labelClass = "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<Users>(DEFAULT_USERS);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBalanceForm, setShowBalanceForm] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", type: "bank", owner: "person1",
    institution: "", currency: "AUD", notes: "", balance: "",
  });

  const [balForm, setBalForm] = useState({ date: "", balance: "", notes: "" });

  const loadAccounts = useCallback(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then(setAccounts)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAccounts();
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
  }, [loadAccounts]);

  const ownerLabel = (owner: string) =>
    owner === "joint" ? "Joint" : owner === "person1" ? users.person1 : users.person2;

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ name: "", type: "bank", owner: "person1", institution: "", currency: "AUD", notes: "", balance: "" });
    setShowForm(false);
    loadAccounts();
  }

  async function handleAddBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!showBalanceForm) return;
    await fetch("/api/balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: showBalanceForm,
        date: balForm.date,
        balance: balForm.balance,
        notes: balForm.notes,
      }),
    });
    setBalForm({ date: "", balance: "", notes: "" });
    setShowBalanceForm(null);
    loadAccounts();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this account and all its data?")) return;
    await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
    loadAccounts();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
            Accounts
          </h1>
          <p className="text-sm text-gbx-muted font-body mt-1">
            Manage accounts and record balance snapshots
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
        >
          {showForm ? "Cancel" : "Add Account"}
        </button>
      </div>

      {/* New account form */}
      {showForm && (
        <form onSubmit={handleCreateAccount} className="bg-white border border-gbx-border p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Account Name</label>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Owner</label>
              <select className={inputClass} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                {[
                  { value: "person1", label: users.person1 },
                  { value: "person2", label: users.person2 },
                  { value: "joint", label: "Joint" },
                ].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Institution</label>
              <input className={inputClass} value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} placeholder="e.g. CommBank" />
            </div>
            <div>
              <label className={labelClass}>Opening Balance</label>
              <input type="number" step="0.01" className={inputClass} value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <button type="submit" className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors">
            Create Account
          </button>
        </form>
      )}

      {/* Account list */}
      {accounts.length === 0 ? (
        <div className="bg-gbx-soft border border-gbx-border p-12 text-center">
          <p className="text-gbx-muted font-body">No accounts yet. Add your first account to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="bg-white border border-gbx-border p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-body font-medium text-gbx-charcoal text-sm">
                    {acc.name}
                  </h3>
                  <p className="text-[10px] uppercase tracking-[0.15em] text-gbx-muted font-body mt-0.5">
                    {TYPE_LABELS[acc.type]} · {ownerLabel(acc.owner)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(acc.id)}
                  className="text-gbx-muted hover:text-red-500 text-xs transition-colors"
                  title="Delete account"
                >
                  ×
                </button>
              </div>

              {acc.institution && (
                <p className="text-xs text-gbx-muted font-body">{acc.institution}</p>
              )}

              <div className="border-t border-gbx-border pt-3">
                <p className="font-data text-xl text-gbx-charcoal">
                  {acc.latest_balance !== null || acc.holdings_value !== null
                    ? formatCurrency(
                        (acc.latest_balance || 0) + (acc.holdings_value || 0)
                      )
                    : "—"}
                </p>
                {acc.holdings_value !== null && acc.holdings_value > 0 && (
                  <p className="text-[11px] text-gbx-muted font-data mt-0.5">
                    {formatCurrency(acc.latest_balance || 0)} cash ·{" "}
                    {formatCurrency(acc.holdings_value)} holdings
                  </p>
                )}
                {acc.latest_balance_date && (
                  <p className="text-[11px] text-gbx-muted font-data mt-0.5">
                    as of {acc.latest_balance_date}
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  setShowBalanceForm(showBalanceForm === acc.id ? null : acc.id);
                  setBalForm({ date: new Date().toISOString().split("T")[0], balance: "", notes: "" });
                }}
                className="text-[11px] text-gbx-teal uppercase tracking-[0.1em] font-body font-medium hover:text-gbx-deep-teal transition-colors"
              >
                {showBalanceForm === acc.id ? "Cancel" : "Update Balance"}
              </button>

              {showBalanceForm === acc.id && (
                <form onSubmit={handleAddBalance} className="space-y-3 border-t border-gbx-border pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Date</label>
                      <input type="date" className={inputClass} value={balForm.date} onChange={(e) => setBalForm({ ...balForm, date: e.target.value })} required />
                    </div>
                    <div>
                      <label className={labelClass}>Balance</label>
                      <input type="number" step="0.01" className={inputClass} value={balForm.balance} onChange={(e) => setBalForm({ ...balForm, balance: e.target.value })} required />
                    </div>
                  </div>
                  <button type="submit" className="bg-gbx-teal text-white px-4 py-2 text-[11px] uppercase tracking-[0.1em] font-body font-medium hover:bg-gbx-deep-teal transition-colors w-full">
                    Save Snapshot
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
