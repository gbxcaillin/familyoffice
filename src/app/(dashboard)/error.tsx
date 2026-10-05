"use client";

import { useEffect } from "react";
import AskClaudeHelp from "@/components/AskClaudeHelp";

// Catch-all error boundary for the dashboard. If any page throws at runtime,
// the user gets a calm explanation and a one-tap way to have Claude interpret
// what went wrong — the "get help when the office struggles" safety net.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the server/browser console for debugging.
    console.error("Dashboard error boundary:", error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="bg-white border border-gbx-border p-6 space-y-4">
        <div>
          <h1 className="font-heading text-2xl font-light text-gbx-charcoal">
            Something went wrong on this page
          </h1>
          <p className="text-sm text-gbx-muted font-body mt-1">
            The page hit an unexpected error. You can try again, or ask Claude to explain what
            happened in plain English.
          </p>
        </div>

        {error.message && (
          <pre className="text-[12px] font-data text-gbx-charcoal bg-gbx-soft border border-gbx-border p-3 overflow-x-auto whitespace-pre-wrap">
            {error.message}
            {error.digest ? `\n(ref: ${error.digest})` : ""}
          </pre>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={reset}
            className="px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
          >
            Try again
          </button>
          <AskClaudeHelp
            context={`A page in the Family Office app crashed with a runtime error.\nError message: ${error.message || "(none)"}\n${error.digest ? `Digest: ${error.digest}\n` : ""}Explain in plain, non-technical English what this likely means for the user and what they should try (reload, re-login, check a specific tab, or report it).`}
          />
        </div>
      </div>
    </div>
  );
}
