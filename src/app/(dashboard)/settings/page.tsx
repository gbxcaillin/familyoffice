"use client";

import { useEffect, useState } from "react";

interface LayoutPrefs {
  tabOrder: string[];
  dashboardOrder: string[];
  holdingsOrder: string[];
}

const LABELS: Record<string, Record<string, string>> = {
  tabOrder: {
    dashboard: "Dashboard",
    accounts: "Accounts",
    holdings: "Holdings",
    spending: "Spending",
    import: "Import",
    documents: "Documents",
  },
  dashboardOrder: {
    stats: "Net worth cards",
    charts: "Trend & spending charts",
    allocation: "Asset allocation & cash flow",
    mortgage: "Mortgage projection",
  },
  holdingsOrder: {
    summary: "Summary cards",
    holdings: "Holdings table",
    performance: "Performance",
    trades: "Trade history",
  },
};

const GROUPS: { key: keyof LayoutPrefs; title: string; note: string }[] = [
  {
    key: "tabOrder",
    title: "Page order",
    note: "The order of the tabs across the top",
  },
  {
    key: "dashboardOrder",
    title: "Dashboard sections",
    note: "Top-to-bottom order on the Dashboard tab",
  },
  {
    key: "holdingsOrder",
    title: "Holdings sections",
    note: "Top-to-bottom order on the Holdings tab",
  },
];

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<LayoutPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/prefs")
      .then((r) => r.json())
      .then(setPrefs)
      .catch(() => {});
  }, []);

  function move(group: keyof LayoutPrefs, index: number, delta: -1 | 1) {
    if (!prefs) return;
    const list = [...prefs[group]];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setPrefs({ ...prefs, [group]: list });
    setSaved(false);
  }

  async function save(next?: LayoutPrefs) {
    const toSave = next || prefs;
    if (!toSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      const data = await res.json();
      if (!data.error) {
        setPrefs(data);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    await save({
      tabOrder: Object.keys(LABELS.tabOrder),
      dashboardOrder: Object.keys(LABELS.dashboardOrder),
      holdingsOrder: Object.keys(LABELS.holdingsOrder),
    });
  }

  if (!prefs) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gbx-muted font-body text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
            Settings
          </h1>
          <p className="text-sm text-gbx-muted font-body mt-1">
            Arrange the app your way — these choices are saved to your login,
            so you and your partner can each have your own layout
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={reset}
            disabled={saving}
            className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium border border-gbx-border text-gbx-muted hover:text-gbx-charcoal hover:border-gbx-teal transition-colors disabled:opacity-50"
          >
            Reset to Default
          </button>
          <button
            onClick={() => save()}
            disabled={saving}
            className="px-4 py-2 text-xs uppercase tracking-[0.15em] font-body font-medium bg-gbx-teal text-white hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : saved ? "Saved ✓" : "Save Layout"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {GROUPS.map((group) => (
          <div key={group.key} className="bg-white border border-gbx-border p-4 sm:p-6">
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
              {group.title}
            </h2>
            <p className="text-[11px] text-gbx-muted font-body mt-1 mb-4">
              {group.note}
            </p>
            <div className="space-y-2">
              {prefs[group.key].map((id, i) => (
                <div
                  key={id}
                  className="flex items-center justify-between border border-gbx-border px-3 py-2.5 bg-gbx-soft/40"
                >
                  <span className="text-sm font-body text-gbx-charcoal">
                    <span className="font-data text-[11px] text-gbx-muted mr-2">
                      {i + 1}
                    </span>
                    {LABELS[group.key][id] || id}
                  </span>
                  <span className="flex gap-1">
                    <button
                      onClick={() => move(group.key, i, -1)}
                      disabled={i === 0}
                      className="w-8 h-8 border border-gbx-border text-gbx-muted hover:text-gbx-teal hover:border-gbx-teal transition-colors disabled:opacity-30 disabled:hover:text-gbx-muted disabled:hover:border-gbx-border"
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => move(group.key, i, 1)}
                      disabled={i === prefs[group.key].length - 1}
                      className="w-8 h-8 border border-gbx-border text-gbx-muted hover:text-gbx-teal hover:border-gbx-teal transition-colors disabled:opacity-30 disabled:hover:text-gbx-muted disabled:hover:border-gbx-border"
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gbx-muted font-body">
        Changes apply after saving — other pages pick up the new layout next
        time they load.
      </p>
    </div>
  );
}
