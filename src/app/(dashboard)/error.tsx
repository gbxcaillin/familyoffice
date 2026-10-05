"use client";

import { useEffect } from "react";

// Catch-all error boundary for the dashboard. A runtime crash is a code fault
// Claude can't repair from here, so this stays a calm recovery screen: retry,
// and the details to report if it persists.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
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
            The page hit an unexpected error. Try again — if it keeps happening, send the reference
            below.
          </p>
        </div>

        {(error.message || error.digest) && (
          <pre className="text-[12px] font-data text-gbx-charcoal bg-gbx-soft border border-gbx-border p-3 overflow-x-auto whitespace-pre-wrap">
            {error.message}
            {error.digest ? `\n(ref: ${error.digest})` : ""}
          </pre>
        )}

        <button
          onClick={reset}
          className="px-4 py-2 bg-gbx-teal text-white text-xs uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
