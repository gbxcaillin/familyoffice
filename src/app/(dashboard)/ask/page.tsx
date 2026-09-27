"use client";

import { useEffect, useRef, useState } from "react";
import InfoTip from "@/components/InfoTip";

interface Query {
  sql: string;
  rowCount?: number;
  error?: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  queries?: Query[];
  pending?: boolean;
  error?: boolean;
}

const EXAMPLES = [
  "What's our current net worth?",
  "How much did we spend last month, by category?",
  "What are our five largest holdings right now?",
  "What's our savings rate this year?",
  "How has our net worth moved over the last 3 months?",
  "Which budget categories are we over on this month?",
];

export default function AskPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showSql, setShowSql] = useState<Record<number, boolean>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agent/ask")
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d?.configured)))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");

    // Plain-text history for follow-up context (exclude the pending/error rows).
    const history = msgs
      .filter((m) => !m.pending && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    setMsgs((m) => [
      ...m,
      { role: "user", content: q },
      { role: "assistant", content: "", pending: true },
    ]);
    setBusy(true);

    try {
      const res = await fetch("/api/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const data = await res.json();
      setMsgs((m) => {
        const next = [...m];
        const i = next.length - 1;
        if (!res.ok) {
          next[i] = {
            role: "assistant",
            content: data?.error || "Something went wrong.",
            error: true,
          };
        } else {
          next[i] = {
            role: "assistant",
            content: data.answer || "No answer.",
            queries: data.queries || [],
          };
        }
        return next;
      });
    } catch {
      setMsgs((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          content: "Network error — please try again.",
          error: true,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal flex items-center gap-2">
          Ask your money
          <InfoTip label="How this works">
            <p className="mb-2">
              Ask questions in plain English about your accounts, holdings, spending, super and net
              worth. The assistant writes and runs its own <strong>read-only</strong> queries against
              your data to answer — it can never change anything.
            </p>
            <p>
              Your question and the query results are sent to the Claude API to compute the answer.
              Nothing is stored there.
            </p>
          </InfoTip>
        </h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          A natural-language view over everything in the dashboard — grounded in your live data.
        </p>
      </div>

      {configured === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-body p-4">
          The assistant isn&apos;t configured yet. Set <code className="font-data">ANTHROPIC_API_KEY</code>{" "}
          in the server environment and restart the app.
        </div>
      )}

      {/* Conversation */}
      <div className="bg-white border border-gbx-border">
        <div className="min-h-[280px] max-h-[60vh] overflow-y-auto p-4 flex flex-col gap-4">
          {msgs.length === 0 && (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-gbx-muted font-body">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    disabled={busy || configured === false}
                    className="text-left text-[13px] font-body text-gbx-charcoal bg-gbx-soft border border-gbx-border px-3 py-2 hover:border-gbx-teal hover:text-gbx-teal transition-colors disabled:opacity-50"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="self-end max-w-[85%]">
                <div className="bg-gbx-teal text-white px-4 py-2.5 text-sm font-body whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="self-start max-w-[92%] w-full">
                <div
                  className={`px-4 py-3 text-sm font-body whitespace-pre-wrap border ${
                    m.error
                      ? "bg-red-50 border-red-200 text-red-700"
                      : "bg-gbx-soft border-gbx-border text-gbx-charcoal"
                  }`}
                >
                  {m.pending ? (
                    <span className="text-gbx-muted">Thinking…</span>
                  ) : (
                    m.content
                  )}
                </div>
                {m.queries && m.queries.length > 0 && (
                  <div className="mt-1">
                    <button
                      onClick={() => setShowSql((s) => ({ ...s, [i]: !s[i] }))}
                      className="text-[11px] uppercase tracking-[0.12em] font-body text-gbx-muted hover:text-gbx-teal transition-colors"
                    >
                      {showSql[i] ? "Hide" : "Show"} {m.queries.length}{" "}
                      {m.queries.length === 1 ? "query" : "queries"}
                    </button>
                    {showSql[i] && (
                      <div className="mt-2 flex flex-col gap-2">
                        {m.queries.map((q, j) => (
                          <div key={j} className="bg-gbx-void/95 text-white/90 p-3 overflow-x-auto">
                            <pre className="text-[12px] font-data whitespace-pre-wrap">{q.sql}</pre>
                            <p className="text-[10px] font-body text-white/40 mt-1">
                              {q.error
                                ? `error: ${q.error}`
                                : `${q.rowCount ?? 0} row${q.rowCount === 1 ? "" : "s"}`}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-gbx-border p-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={
              configured === false ? "Configure ANTHROPIC_API_KEY to enable…" : "Ask about your finances…"
            }
            disabled={busy || configured === false}
            className="flex-1 resize-none bg-white border border-gbx-border px-3 py-2.5 text-sm font-body text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors disabled:opacity-50"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim() || configured === false}
            className="bg-gbx-teal text-white px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-body font-medium hover:bg-gbx-deep-teal transition-colors disabled:opacity-50 shrink-0"
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gbx-muted font-body">
        Answers are computed live from your data via read-only queries. Double-check anything important
        against the underlying tabs — the assistant can occasionally misread a question.
      </p>
    </div>
  );
}
