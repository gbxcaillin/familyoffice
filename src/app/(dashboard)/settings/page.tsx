"use client";

import { useEffect, useState } from "react";

interface LayoutPrefs {
  tabOrder: string[];
  dashboardOrder: string[];
  holdingsOrder: string[];
  spendingOrder: string[];
  accountsOrder: string[];
  superOrder: string[];
}

// Static catalogues: the fixed sections whose labels are known at build time.
const LABELS: Record<string, Record<string, string>> = {
  tabOrder: {
    dashboard: "Dashboard",
    accounts: "Accounts",
    holdings: "Holdings",
    super: "Super",
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
  spendingOrder: {
    summary: "Income / expenses summary",
    transactions: "Transactions table",
  },
};

// Which keys hold a fixed catalogue (validated against LABELS) vs a dynamic
// list of the user's own account ids (labels fetched at runtime).
const STATIC_KEYS: (keyof LayoutPrefs)[] = [
  "tabOrder",
  "dashboardOrder",
  "holdingsOrder",
  "spendingOrder",
];

const GROUPS: {
  key: keyof LayoutPrefs;
  title: string;
  note: string;
  dynamic?: boolean;
}[] = [
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
  {
    key: "spendingOrder",
    title: "Spending sections",
    note: "Top-to-bottom order on the Spending tab",
  },
  {
    key: "accountsOrder",
    title: "Account cards",
    note: "Order of the cards on the Accounts tab",
    dynamic: true,
  },
  {
    key: "superOrder",
    title: "Super cards",
    note: "Order of the cards on the Super tab",
    dynamic: true,
  },
];

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<LayoutPrefs | null>(null);
  // Labels for the dynamic (account-id) groups, filled from the account lists.
  const [dynamicLabels, setDynamicLabels] = useState<Record<string, Record<string, string>>>({
    accountsOrder: {},
    superOrder: {},
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const res = await fetch("/api/networth/backfill", { method: "POST" });
      const data = await res.json();
      setBackfillMsg(
        data.error
          ? `Failed: ${data.error}`
          : `Rebuilt ${data.written} weeks of net worth history from market prices. Open the Dashboard to see the trend.`
      );
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    // Load prefs together with the account/super lists so the dynamic card
    // groups can be labelled and normalised (drop deleted accounts, append new).
    Promise.all([
      fetch("/api/prefs").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/super").then((r) => r.json()).catch(() => ({ accounts: [] })),
    ])
      .then(([data, accts, sup]: [LayoutPrefs, Array<{ id: string; name: string }>, { accounts: Array<{ account_id: string; name: string }> }]) => {
        const merged = { ...data } as LayoutPrefs;

        // Static groups: keep known ids in saved order, append any new ones.
        for (const key of STATIC_KEYS) {
          const cat = LABELS[key] || {};
          const stored = Array.isArray(merged[key]) ? merged[key] : [];
          const missing = Object.keys(cat).filter((k) => !stored.includes(k));
          merged[key] = [...stored.filter((k) => cat[k]), ...missing];
        }

        // Dynamic groups: normalise the saved id order against live accounts.
        const acctIds = Array.isArray(accts) ? accts.map((a) => a.id) : [];
        const superIds = Array.isArray(sup?.accounts) ? sup.accounts.map((a) => a.account_id) : [];
        const normalise = (stored: string[] | undefined, ids: string[]) => {
          const s = Array.isArray(stored) ? stored.filter((id) => ids.includes(id)) : [];
          const seen = new Set(s);
          return [...s, ...ids.filter((id) => !seen.has(id))];
        };
        merged.accountsOrder = normalise(merged.accountsOrder, acctIds);
        merged.superOrder = normalise(merged.superOrder, superIds);

        setDynamicLabels({
          accountsOrder: Object.fromEntries((accts || []).map((a) => [a.id, a.name])),
          superOrder: Object.fromEntries((sup?.accounts || []).map((a) => [a.account_id, a.name])),
        });
        setPrefs(merged);
      })
      .catch(() => {});

    setIsIOS(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

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
    // Reset the static section orders to defaults; keep the account/super card
    // orders as the live account order (natural order).
    await save({
      tabOrder: Object.keys(LABELS.tabOrder),
      dashboardOrder: Object.keys(LABELS.dashboardOrder),
      holdingsOrder: Object.keys(LABELS.holdingsOrder),
      spendingOrder: Object.keys(LABELS.spendingOrder),
      accountsOrder: Object.keys(dynamicLabels.accountsOrder),
      superOrder: Object.keys(dynamicLabels.superOrder),
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

      {/* Install as an app */}
      <div className="bg-gbx-charcoal border border-white/5 p-4 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-192.png"
              alt="GBX app icon"
              className="w-12 h-12 border border-white/10"
            />
            <div>
              <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
                GBX Family Office App
              </h2>
              <p className="text-sm text-white/60 font-body mt-1">
                {installed
                  ? "Installed on this device — open it from your home screen."
                  : "Install to your home screen for a full-screen app with the GBX icon."}
              </p>
            </div>
          </div>
          {!installed && installPrompt && (
            <button
              onClick={handleInstall}
              className="px-5 py-2.5 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
            >
              Download App
            </button>
          )}
          {!installed && !installPrompt && (
            <p className="text-xs text-white/50 font-body max-w-xs">
              {isIOS
                ? "In Safari: tap the Share button, then “Add to Home Screen”."
                : "In your browser menu (⋮): tap “Add to Home screen” or “Install app”."}
            </p>
          )}
          {installed && (
            <span className="text-xs uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
              Installed ✓
            </span>
          )}
        </div>
      </div>

      {/* Net worth history */}
      <div className="bg-white border border-gbx-border p-4 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
              Net Worth History
            </h2>
            <p className="text-sm text-gbx-muted font-body mt-1 max-w-xl">
              Reconstruct the past year of your net worth trend from historical
              market prices, so the chart isn&apos;t empty while daily snapshots
              build up. Early points assume today&apos;s positions and account
              balances — an estimate that reflects how the markets moved.
            </p>
            {backfillMsg && (
              <p className="text-sm text-gbx-teal font-body font-medium mt-2">
                {backfillMsg}
              </p>
            )}
          </div>
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="px-5 py-2.5 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
          >
            {backfilling ? "Rebuilding..." : "Rebuild History"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {GROUPS.filter(
          (g) => !g.dynamic || (prefs[g.key] && prefs[g.key].length > 0)
        ).map((group) => (
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
                    {LABELS[group.key]?.[id] || dynamicLabels[group.key]?.[id] || id}
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
