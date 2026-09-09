"use client";

import { useEffect, useState } from "react";

interface RiskLevel {
  key: string;
  label: string;
  nominalReturn: number;
  blurb: string;
}
interface PersonProfile {
  birth: string | null;
  income: number | null;
}
interface Profile {
  p1: PersonProfile;
  p2: PersonProfile;
  riskLevel: string | null;
  desiredReturn: number | null;
  annualSpend: number | null;
}

const inputClass =
  "w-full bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors";
const labelClass =
  "block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5";
const cardClass = "bg-white border border-gbx-border p-6 space-y-4";

export default function ProfilePage() {
  const [users, setUsers] = useState({ person1: "Person 1", person2: "Person 2" });
  const [risks, setRisks] = useState<RiskLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [form, setForm] = useState<{
    birth1: string; income1: string;
    birth2: string; income2: string;
    riskLevel: string; desiredReturn: string; annualSpend: string;
  }>({
    birth1: "", income1: "", birth2: "", income2: "",
    riskLevel: "", desiredReturn: "", annualSpend: "",
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d: { profile: Profile; users: { person1: string; person2: string }; riskLevels: RiskLevel[] }) => {
        setUsers(d.users);
        setRisks(d.riskLevels || []);
        const p = d.profile;
        setForm({
          birth1: p.p1.birth || "",
          income1: p.p1.income != null ? String(p.p1.income) : "",
          birth2: p.p2.birth || "",
          income2: p.p2.income != null ? String(p.p2.income) : "",
          riskLevel: p.riskLevel || "",
          desiredReturn: p.desiredReturn != null ? String(p.desiredReturn) : "",
          annualSpend: p.annualSpend != null ? String(p.annualSpend) : "",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSavedMsg("");
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p1: { birth: form.birth1, income: form.income1 },
        p2: { birth: form.birth2, income: form.income2 },
        riskLevel: form.riskLevel,
        desiredReturn: form.desiredReturn,
        annualSpend: form.annualSpend,
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved. These now feed the Freedom Number and scenarios." : "Save failed — try again.");
  }

  const selectedRisk = risks.find((r) => r.key === form.riskLevel);
  const nominalReturn =
    form.desiredReturn !== "" ? parseFloat(form.desiredReturn) : selectedRisk?.nominalReturn;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal">Profile</h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          Personal details that feed the Freedom Number, Coast FIRE and scenario projections
        </p>
      </div>

      {/* People */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { name: users.person1, birth: "birth1", income: "income1" },
          { name: users.person2, birth: "birth2", income: "income2" },
        ].map((p) => (
          <div key={p.birth} className={cardClass}>
            <h2 className="font-body font-medium text-gbx-charcoal">{p.name}</h2>
            <div>
              <label className={labelClass}>Birth month</label>
              <input
                type="month"
                className={inputClass}
                value={form[p.birth as "birth1"]}
                onChange={(e) => setForm({ ...form, [p.birth]: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Gross annual income (AUD)</label>
              <input
                type="number"
                className={inputClass}
                value={form[p.income as "income1"]}
                onChange={(e) => setForm({ ...form, [p.income]: e.target.value })}
                placeholder="e.g. 120000"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Risk & planning */}
      <div className={cardClass}>
        <h2 className="font-body font-medium text-gbx-charcoal">Risk &amp; planning</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Risk level</label>
            <select
              className={inputClass}
              value={form.riskLevel}
              onChange={(e) => setForm({ ...form, riskLevel: e.target.value })}
            >
              <option value="">— Select —</option>
              {risks.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label} · ~{r.nominalReturn}% nominal ({r.blurb})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Desired return % — nominal (overrides risk)</label>
            <input
              type="number"
              step="0.1"
              className={inputClass}
              value={form.desiredReturn}
              onChange={(e) => setForm({ ...form, desiredReturn: e.target.value })}
              placeholder="blank = use risk level"
            />
          </div>
          <div>
            <label className={labelClass}>Planned annual spend in retirement (AUD)</label>
            <input
              type="number"
              className={inputClass}
              value={form.annualSpend}
              onChange={(e) => setForm({ ...form, annualSpend: e.target.value })}
              placeholder="blank = estimated from spending"
            />
          </div>
        </div>
        {nominalReturn != null && !isNaN(nominalReturn) && (
          <p className="text-[12px] text-gbx-muted font-body">
            Calculations will use a <span className="text-gbx-teal font-medium">{nominalReturn}% nominal</span> return.
            Inflation is set on the FIRE tab and subtracted to give the real return used in projections.
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
        {savedMsg && <span className="text-[12px] text-gbx-muted font-body">{savedMsg}</span>}
      </div>

      <p className="text-[11px] text-gbx-muted font-body">
        Note: income here is used to estimate your saving rate for FIRE projections. The fixed FIRE
        target, withdrawal rate and whether to include home equity live on the FIRE tab.
      </p>
    </div>
  );
}
