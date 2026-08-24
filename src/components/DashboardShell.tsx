"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const tabs = [
  { name: "Dashboard", href: "/" },
  { name: "Accounts", href: "/accounts" },
  { name: "Holdings", href: "/holdings" },
  { name: "Spending", href: "/spending" },
  { name: "Documents", href: "/documents" },
];

export default function DashboardShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gbx-paper">
      {/* Header — dark premium moment */}
      <header className="bg-gbx-void border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="border border-gbx-teal/40 px-4 py-1.5">
                <span className="font-heading text-xl font-light text-gbx-teal tracking-wide">
                  GBX
                </span>
              </div>
              <span className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-body font-medium hidden sm:block">
                Family Office
              </span>
            </div>

            <div className="flex items-center gap-3 sm:gap-6">
              <span className="text-sm text-white/50 font-body">
                {userName}
              </span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-xs text-white/30 hover:text-white/60 uppercase tracking-[0.15em] font-body font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="bg-white border-b border-gbx-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-0 -mb-px overflow-x-auto">
            {tabs.map((tab) => {
              const isActive =
                tab.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(tab.href);
              return (
                <button
                  key={tab.href}
                  onClick={() => router.push(tab.href)}
                  className={`px-4 sm:px-5 py-3.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? "border-gbx-teal text-gbx-teal"
                      : "border-transparent text-gbx-muted hover:text-gbx-charcoal hover:border-gbx-border"
                  }`}
                >
                  {tab.name}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
