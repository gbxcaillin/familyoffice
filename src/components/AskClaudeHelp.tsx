"use client";

import { useState } from "react";

// A compact "Ask Claude to explain this" affordance that appears when the app
// hits a snag (a failed import, an error, a figure that looks wrong). It feeds
// the situation to the embedded assistant and shows a plain-English
// interpretation plus what to do next. Reuses /api/agent/ask, so it runs on the
// same Claude subscription as the Ask tab; if that isn't configured yet it says
// so quietly instead of erroring.
export default function AskClaudeHelp({
  context,
  label = "Ask Claude to explain this",
  question = "Something in our Family Office app isn't working as expected. In plain English, what does this most likely mean, and what should we do next?",
}: {
  context: string;
  label?: string;
  question?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followup, setFollowup] = useState("");

  async function ask(extra?: string) {
    setLoading(true);
    setError(null);
    try {
      const composed =
        `${extra?.trim() ? extra.trim() : question}\n\n` +
        `--- what happened in the app ---\n${context}`;
      const res = await fetch("/api/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: composed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          res.status === 503
            ? "The Claude assistant isn't set up yet (needs its subscription token on the server)."
            : data?.error || "Couldn't reach the assistant."
        );
        return;
      }
      setAnswer(data.answer || "No explanation came back.");
    } catch {
      setError("Couldn't reach the assistant — check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          ask();
        }}
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-body font-medium text-gbx-teal hover:text-gbx-deep-teal transition-colors"
      >
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gbx-teal text-[10px] leading-none">
          ?
        </span>
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 bg-gbx-soft border border-gbx-border p-3 space-y-2 max-w-2xl">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted">
          Claude&apos;s take
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-gbx-muted hover:text-gbx-charcoal text-sm leading-none"
          title="Close"
        >
          ×
        </button>
      </div>

      {loading && <p className="text-sm text-gbx-muted font-body">Thinking…</p>}
      {error && <p className="text-sm text-red-600 font-body">{error}</p>}
      {answer && !loading && (
        <p className="text-sm text-gbx-charcoal font-body whitespace-pre-wrap">{answer}</p>
      )}

      {!loading && (answer || error) && (
        <div className="flex items-end gap-2 pt-1">
          <input
            value={followup}
            onChange={(e) => setFollowup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && followup.trim()) {
                const q = followup;
                setFollowup("");
                ask(q);
              }
            }}
            placeholder="Ask a follow-up…"
            className="flex-1 bg-white border border-gbx-border px-3 py-2 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal"
          />
          <button
            onClick={() => {
              const q = followup;
              setFollowup("");
              ask(q);
            }}
            disabled={!followup.trim()}
            className="px-3 py-2 bg-gbx-teal text-white text-[11px] uppercase tracking-[0.12em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50 shrink-0"
          >
            Ask
          </button>
        </div>
      )}
    </div>
  );
}
