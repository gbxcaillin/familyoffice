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
  sgRate: number | null;
}
interface Profile {
  p1: PersonProfile;
  p2: PersonProfile;
  riskLevel: string | null;
  desiredReturn: number | null;
  annualSpend: number | null;
  annualInvest: number | null;
}

// Same AU resident tax (2024-25+) + 2% Medicare used server-side, for a live
// take-home preview.
function incomeTaxAU(g: number): number {
  let tax = 0;
  if (g > 190000) tax = 51638 + (g - 190000) * 0.45;
  else if (g > 135000) tax = 31288 + (g - 135000) * 0.37;
  else if (g > 45000) tax = 4288 + (g - 45000) * 0.3;
  else if (g > 18200) tax = (g - 18200) * 0.16;
  return tax + (g > 0 ? g * 0.02 : 0);
}
const fmtAud = (v: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);

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
    birth1: string; income1: string; sg1: string;
    birth2: string; income2: string; sg2: string;
    riskLevel: string; desiredReturn: string; annualSpend: string; annualInvest: string;
  }>({
    birth1: "", income1: "", sg1: "",
    birth2: "", income2: "", sg2: "",
    riskLevel: "", desiredReturn: "", annualSpend: "", annualInvest: "",
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
          sg1: p.p1.sgRate != null ? String(p.p1.sgRate) : "",
          birth2: p.p2.birth || "",
          income2: p.p2.income != null ? String(p.p2.income) : "",
          sg2: p.p2.sgRate != null ? String(p.p2.sgRate) : "",
          riskLevel: p.riskLevel || "",
          desiredReturn: p.desiredReturn != null ? String(p.desiredReturn) : "",
          annualSpend: p.annualSpend != null ? String(p.annualSpend) : "",
          annualInvest: p.annualInvest != null ? String(p.annualInvest) : "",
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
        p1: { birth: form.birth1, income: form.income1, sgRate: form.sg1 },
        p2: { birth: form.birth2, income: form.income2, sgRate: form.sg2 },
        riskLevel: form.riskLevel,
        desiredReturn: form.desiredReturn,
        annualSpend: form.annualSpend,
        annualInvest: form.annualInvest,
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
          { name: users.person1, birth: "birth1", income: "income1", sg: "sg1" },
          { name: users.person2, birth: "birth2", income: "income2", sg: "sg2" },
        ].map((p) => {
          const gross = parseFloat(form[p.income as "income1"]) || 0;
          const sg = form[p.sg as "sg1"] !== "" ? parseFloat(form[p.sg as "sg1"]) : 12;
          const takeHome = gross > 0 ? gross - incomeTaxAU(gross) : 0;
          const superNet = gross > 0 ? gross * (sg / 100) * 0.85 : 0;
          return (
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Gross salary (AUD/yr)</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={form[p.income as "income1"]}
                    onChange={(e) => setForm({ ...form, [p.income]: e.target.value })}
                    placeholder="e.g. 120000"
                  />
                </div>
                <div>
                  <label className={labelClass}>Employer super %</label>
                  <input
                    type="number"
                    step="0.1"
                    className={inputClass}
                    value={form[p.sg as "sg1"]}
                    onChange={(e) => setForm({ ...form, [p.sg]: e.target.value })}
                    placeholder="12"
                  />
                </div>
              </div>
              {gross > 0 && (
                <p className="text-[11px] text-gbx-muted font-body">
                  Take-home ≈ <span className="text-gbx-charcoal font-data">{fmtAud(takeHome)}</span>{" "}
                  · employer super (net of 15% tax) ≈{" "}
                  <span className="text-gbx-charcoal font-data">{fmtAud(superNet)}</span>/yr
                </p>
              )}
            </div>
          );
        })}
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
            <label className={labelClass}>Annual spending (AUD) — manual</label>
            <input
              type="number"
              className={inputClass}
              value={form.annualSpend}
              onChange={(e) => setForm({ ...form, annualSpend: e.target.value })}
              placeholder="e.g. 90000"
            />
          </div>
          <div>
            <label className={labelClass}>Invested outside super / yr (AUD) — manual</label>
            <input
              type="number"
              className={inputClass}
              value={form.annualInvest}
              onChange={(e) => setForm({ ...form, annualInvest: e.target.value })}
              placeholder="what you invest each year"
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
        The projections auto-factor only the unavoidable flows — after-tax income, employer super
        (SGC), and your mortgage &amp; its repayments — plus live account balances. Your spending and
        the amount you invest each year are <strong>manual</strong> figures you set here (nothing is
        estimated from the transactions table). Target, withdrawal rate and home-equity toggle live
        on the FIRE tab.
      </p>
    </div>
  );
}
