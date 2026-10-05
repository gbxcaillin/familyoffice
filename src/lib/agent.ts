import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import Database from "better-sqlite3";
import path from "path";
import type { ImportKind } from "@/lib/import-detect";

// ---------------------------------------------------------------------------
// "Ask your money" — a tool-using agent that answers natural-language questions
// about the household finances by writing and running its own READ-ONLY SQL.
//
// This runs on the Claude Agent SDK against the household's Claude subscription
// (via CLAUDE_CODE_OAUTH_TOKEN), NOT the pay-per-token API. The agent's ONLY
// tool is run_sql; every built-in tool (file/bash/web) is disabled, and any
// tool call that isn't the pre-approved run_sql is denied without prompting.
//
// Safety, in layers:
//   1. A dedicated connection opened readonly — SQLite itself rejects writes.
//   2. A statement guard — only a single SELECT / WITH … SELECT is allowed.
//   3. A hard row cap so a broad query can't blow the context budget.
// ---------------------------------------------------------------------------

const DB_PATH = path.join(process.cwd(), "data", "familyoffice.db");
// Leave undefined to use the subscription's default model. Set AGENT_MODEL to
// pin one (e.g. "claude-sonnet-5") if the plan allows it.
const MODEL = process.env.AGENT_MODEL || undefined;
const MAX_ROWS = 500;
const MAX_TURNS = 8;
const SERVER_NAME = "familyoffice";
const TOOL_FQN = `mcp__${SERVER_NAME}__run_sql`;

let roDb: Database.Database | undefined;

// A separate, read-only handle. The main app connection stays read/write; this
// one physically cannot mutate the database even if the guard were bypassed.
function getReadonlyDb(): Database.Database {
  if (!roDb) {
    roDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    roDb.pragma("query_only = ON");
  }
  return roDb;
}

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate)\b/i;

function assertReadOnly(raw: string): string {
  const sql = raw.trim().replace(/;+\s*$/, "");
  if (!sql) throw new Error("Empty query.");
  if (sql.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Only SELECT queries are allowed.");
  if (FORBIDDEN.test(sql)) throw new Error("Only read-only SELECT queries are allowed.");
  return sql;
}

interface SqlResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

function runReadonlySql(raw: string): SqlResult {
  const sql = assertReadOnly(raw);
  const db = getReadonlyDb();
  const stmt = db.prepare(sql);
  const all = stmt.raw().all() as unknown[][];
  const columns = stmt.columns().map((c) => c.name);
  const truncated = all.length > MAX_ROWS;
  return { columns, rows: all.slice(0, MAX_ROWS), rowCount: all.length, truncated };
}

// A compact, always-accurate schema summary built from the live database, plus
// curated notes so the model reads the data the way the app does.
function schemaSummary(): string {
  const db = getReadonlyDb();
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[];
  const lines: string[] = [];
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as {
      name: string;
      type: string;
    }[];
    lines.push(`${t.name}(${cols.map((c) => c.name).join(", ")})`);
  }
  return lines.join("\n");
}

const NOTES = `
Reading notes (how the app interprets this data):
- All amounts are in AUD unless a currency column says otherwise.
- accounts.type is one of bank, brokerage, super, property, crypto, loan, other.
  A 'loan' account is a liability (e.g. the mortgage); its balance is the amount owed.
- accounts.owner is person1, person2, or joint. person1 = Caillin, person2 = Kirra.
- transactions.amount: negative = money out (an expense), positive = money in (income).
  Use date >= date('now','start of month') for "this month"; SQLite date() functions work.
- balances holds point-in-time account balances over time (latest per account = current).
- holdings are share/ETF/crypto positions (units, cost_basis); price_cache has the latest
  price per ticker — join holdings.ticker = price_cache.ticker and multiply units * price
  for current market value. change_percent is the day move.
- snapshots is the daily net-worth history (total_net_worth, assets, liabilities, per-owner
  totals). Use it for trends over time.
- super_config / super_price_history cover superannuation balances and unit-price history.
- budgets is the planned monthly budget per category (monthly, essential=1/0). Actual spend
  comes from transactions, not this table.
- app_settings holds JSON blobs in the 'value' column: key 'fire' = Freedom Number/FIRE
  assumptions (targetOverride is the $ target, includeHome, birthP1/birthP2 = birth months),
  key 'profile' = per-person income/super/risk. Read the JSON text from the value column.
`.trim();

function buildSystemPrompt(schema: string, today: string): string {
  return `You are the analyst for a private two-person Australian family-office net-worth dashboard (the users are Caillin and Kirra). You answer questions about their own finances.

You have ONE tool: ${TOOL_FQN}, which runs a single read-only SQL SELECT against their SQLite database and returns the rows. Query the database to ground every factual answer — never guess at figures. You may call the tool several times to build up an answer (e.g. explore the schema, then compute).

Database tables and columns:
${schema}

${NOTES}

You may also be asked to HELP INTERPRET a problem in the app — an error message, a failed import, or a result that looks wrong. When that happens: explain in plain, non-technical English what it most likely means, then give one or two concrete next steps the user can take themselves (these are non-technical users). You don't need to run a query for that unless checking the data would actually help (e.g. "these numbers look off" — then look). Don't paste stack traces back; translate them.

Answering style:
- Be concise and direct. Lead with the number (or the plain-English cause), then a one-line explanation.
- Format money as AUD with thousands separators (e.g. $1,234,567). Round sensibly.
- If a question is ambiguous, make the most reasonable assumption and state it briefly.
- If the data needed isn't there, say so plainly rather than inventing it.
- Never attempt anything other than SELECT queries; you cannot change any data.
- Today's date is ${today}.`;
}

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskResult {
  answer: string;
  queries: { sql: string; rowCount?: number; error?: string }[];
}

// Subscription auth: the Agent SDK reads CLAUDE_CODE_OAUTH_TOKEN (from
// `claude setup-token`). We treat the token's presence as "configured".
export function agentConfigured(): boolean {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

export async function askMoney(question: string, history: AskTurn[] = []): Promise<AskResult> {
  if (!agentConfigured()) {
    throw new Error(
      "The assistant isn't configured. Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) in the server environment."
    );
  }

  const queries: AskResult["queries"] = [];

  // One in-process tool: read-only SQL. The handler records each query so the
  // UI can show exactly what ran.
  const runSql = tool(
    "run_sql",
    "Run a single read-only SQL SELECT query against the family-office SQLite database and get the resulting rows back. Only SELECT / WITH…SELECT statements are permitted.",
    { sql: z.string().describe("A single SQLite SELECT statement (no trailing semicolon).") },
    async (args: { sql: string }) => {
      const sql = String(args.sql ?? "");
      try {
        const r = runReadonlySql(sql);
        queries.push({ sql, rowCount: r.rowCount });
        const payload = {
          columns: r.columns,
          rows: r.rows,
          rowCount: r.rowCount,
          note: r.truncated ? `Showing first ${MAX_ROWS} of ${r.rowCount} rows.` : undefined,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        queries.push({ sql, error: message });
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const server = createSdkMcpServer({
    name: SERVER_NAME,
    version: "1.0.0",
    tools: [runSql],
  });

  // Fold prior turns into a single prompt so follow-ups have context. (The SDK
  // takes a string prompt; we prepend a short transcript.)
  const priorTranscript = history
    .filter((t) => t.content?.trim())
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");
  const prompt = priorTranscript
    ? `${priorTranscript}\n\nUser: ${question}`
    : question;

  const result = query({
    prompt,
    options: {
      model: MODEL,
      systemPrompt: buildSystemPrompt(schemaSummary(), new Date().toISOString().slice(0, 10)),
      mcpServers: { [SERVER_NAME]: server },
      allowedTools: [TOOL_FQN],
      // Strip built-in tools from context; run_sql is the only capability.
      disallowedTools: [
        "Bash",
        "Read",
        "Write",
        "Edit",
        "MultiEdit",
        "NotebookEdit",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Task",
        "TodoWrite",
      ],
      // Deny anything not pre-approved, and never block on an interactive prompt.
      permissionMode: "dontAsk",
      // SDK isolation: don't load ~/.claude, project .claude, or CLAUDE.md.
      settingSources: [],
      maxTurns: MAX_TURNS,
      // Force subscription auth: strip any API key from the subprocess env so
      // CLAUDE_CODE_OAUTH_TOKEN is used (API key would otherwise take priority).
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    },
  });

  let answer = "";
  for await (const message of result) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        answer = message.result?.trim() || "";
      } else {
        throw new Error(
          message.subtype === "error_max_turns"
            ? "That took more steps than I could complete in one go — try narrowing the question."
            : "The assistant couldn't complete that request."
        );
      }
    }
  }

  return { answer: answer || "I couldn't find an answer to that.", queries };
}

// ---------------------------------------------------------------------------
// Agentic import rescue: when the deterministic detectors can't recognise a
// file, hand its raw text to Claude to extract the rows. Claude only EXTRACTS —
// it returns a structured payload via submit_import; the route normalises it and
// the user still confirms in the preview before anything is written. Claude has
// no database access here: its single tool is submit_import.
// ---------------------------------------------------------------------------

export interface AgentParse {
  kind: ImportKind;
  rows: Record<string, string | number | null>[];
  note?: string;
}

const PARSE_SYSTEM = `You extract structured data from financial files for an Australian family-office app (users Caillin and Kirra). You are given the raw text of a statement the app's automatic importer could NOT recognise. Work out what it is and extract every data row, then call submit_import exactly once.

Decide the kind:
- "holdings": a current portfolio / valuation (positions you own now).
- "trades": a buy/sell order or trade history.
- "transactions": a bank/cash account statement (money in and out).

Row shape by kind (use these exact keys):
- holdings: { ticker, name, units, price, value }  (price/value optional if absent)
- trades: { trade_date, ticker, side, units, price, fees }  (fees optional)
- transactions: { date, description, amount, category }  (category optional)

Rules:
- Dates as YYYY-MM-DD.
- Numbers as plain numbers (no $ or commas). For transactions, amount is NEGATIVE for money out (spending) and POSITIVE for money in.
- side is "buy" or "sell".
- ticker is the plain code only (e.g. "VAS", "CBA", "BTC") — the app adds the exchange suffix.
- Extract only rows actually present. Never invent or estimate rows. Skip summary/total lines.
- If you genuinely cannot find any importable rows, call submit_import with an empty rows array and a short note explaining why.`;

export async function parseImportFile(
  text: string,
  opts: { hint?: ImportKind } = {}
): Promise<AgentParse> {
  if (!agentConfigured()) {
    throw new Error(
      "The assistant isn't configured. Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) in the server environment."
    );
  }

  let captured: AgentParse | null = null;

  const submit = tool(
    "submit_import",
    "Submit the rows you extracted from the file, classified as holdings, trades, or transactions.",
    {
      kind: z.enum(["holdings", "trades", "transactions"]),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
      note: z.string().optional(),
    },
    async (args: {
      kind: ImportKind;
      rows: Record<string, string | number | null>[];
      note?: string;
    }) => {
      captured = { kind: args.kind, rows: args.rows || [], note: args.note };
      return { content: [{ type: "text" as const, text: `Received ${captured.rows.length} rows.` }] };
    }
  );

  const server = createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools: [submit] });
  const fqn = `mcp__${SERVER_NAME}__submit_import`;

  // Cap the input so a huge file can't blow the context budget.
  const body = text.length > 100_000 ? text.slice(0, 100_000) : text;
  const prompt =
    (opts.hint ? `The user says this file is ${opts.hint}.\n\n` : "") +
    `Raw file text follows. Extract the rows and call submit_import.\n\n---\n${body}`;

  const result = query({
    prompt,
    options: {
      model: MODEL,
      systemPrompt: PARSE_SYSTEM,
      mcpServers: { [SERVER_NAME]: server },
      allowedTools: [fqn],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
        "Glob", "Grep", "WebSearch", "WebFetch", "Task", "TodoWrite",
      ],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 4,
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    },
  });

  for await (const message of result) {
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error("Claude couldn't read this file — try exporting it as a CSV.");
    }
  }

  if (!captured) {
    throw new Error("Claude couldn't make sense of this file — try exporting it as a CSV.");
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Bulk transaction categorisation. Given uncategorised transactions and the
// household's category list, Claude proposes a category for each. It only
// proposes — the route validates against the allowed list and the user confirms
// before anything is written. Claude has no DB access; its one tool is
// submit_categories.
// ---------------------------------------------------------------------------

export interface CategorizeTxn {
  id: string;
  date: string;
  amount: number;
  description: string;
}

export async function categorizeTransactions(
  txns: CategorizeTxn[],
  expenseCategories: string[],
  incomeCategories: string[]
): Promise<{ id: string; category: string }[]> {
  if (!agentConfigured()) {
    throw new Error(
      "The assistant isn't configured. Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) in the server environment."
    );
  }
  if (txns.length === 0) return [];

  let captured: { id: string; category: string }[] | null = null;

  const submit = tool(
    "submit_categories",
    "Submit the chosen category for each transaction id.",
    {
      assignments: z.array(
        z.object({ id: z.string(), category: z.string() })
      ),
    },
    async (args: { assignments: { id: string; category: string }[] }) => {
      captured = args.assignments || [];
      return { content: [{ type: "text" as const, text: `Received ${captured.length} assignments.` }] };
    }
  );

  const server = createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools: [submit] });
  const fqn = `mcp__${SERVER_NAME}__submit_categories`;

  const system = `You categorise bank transactions for a private Australian family-office app (users Caillin and Kirra).
You are given transactions and the ONLY category names you may use. Assign each transaction the single best-fitting category.

Rules:
- A negative amount is money out (an expense) — use an EXPENSE category.
- A positive amount is money in (income) — use an INCOME category.
- Use the category names EXACTLY as given; do not invent new ones.
- If an expense doesn't clearly fit, use "Other".
- Give every transaction id exactly one assignment, then call submit_categories once.

Expense categories: ${expenseCategories.join(", ")}
Income categories: ${incomeCategories.join(", ")}`;

  const lines = txns
    .map((t) => `${t.id} | ${t.date} | ${t.amount} | ${t.description}`)
    .join("\n");
  const prompt = `Categorise these transactions (id | date | amount | description):\n\n${lines}`;

  const result = query({
    prompt,
    options: {
      model: MODEL,
      systemPrompt: system,
      mcpServers: { [SERVER_NAME]: server },
      allowedTools: [fqn],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
        "Glob", "Grep", "WebSearch", "WebFetch", "Task", "TodoWrite",
      ],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 4,
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    },
  });

  for await (const message of result) {
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error("Claude couldn't categorise these — try again.");
    }
  }
  return captured || [];
}

// ---------------------------------------------------------------------------
// FIRE natural-language what-if. The user describes a life change in words
// ("Kirra goes to 3 days a week"); Claude maps it to new values for the
// scenario sliders and explains its assumption. Nothing is saved — it just
// moves the sliders so the projection re-runs. Claude's one tool is submit_whatif.
// ---------------------------------------------------------------------------

// The scenario fields Claude is allowed to change (numbers only).
const WHATIF_FIELDS = [
  "spend", "netIncome", "accReturn", "retReturn", "inflation",
  "investWithin", "investExtra", "superContrib", "retireAge",
  "extraMonthly", "longevity", "swr", "propGrowth",
] as const;
type WhatIfField = (typeof WHATIF_FIELDS)[number];

export interface WhatIfResult {
  changes: Partial<Record<WhatIfField, number>>;
  explanation: string;
}

export async function whatIfScenario(
  phrase: string,
  scenario: Record<string, unknown>
): Promise<WhatIfResult> {
  if (!agentConfigured()) {
    throw new Error(
      "The assistant isn't configured. Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) in the server environment."
    );
  }

  let captured: Record<string, unknown> | null = null;

  const shape: Record<string, z.ZodTypeAny> = { explanation: z.string() };
  for (const f of WHATIF_FIELDS) shape[f] = z.number().optional();

  const submit = tool(
    "submit_whatif",
    "Submit the new absolute values for the scenario fields that should change, plus a short explanation. Omit fields that stay the same.",
    shape,
    async (args: Record<string, unknown>) => {
      captured = args;
      return { content: [{ type: "text" as const, text: "Received." }] };
    }
  );

  const server = createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools: [submit] });
  const fqn = `mcp__${SERVER_NAME}__submit_whatif`;

  const current = Object.fromEntries(
    WHATIF_FIELDS.map((f) => [f, (scenario as Record<string, number>)[f]])
  );

  const system = `You adjust a retirement (FIRE) projection for a private Australian family-office app (users Caillin and Kirra). The user describes a change in plain English; you translate it into new values for the scenario inputs below and call submit_whatif once.

Fields (all numbers; return ABSOLUTE new values, only for fields that change):
- spend: annual all-in household spend in $ (includes mortgage).
- netIncome: household after-tax income in $/yr.
- accReturn: nominal investment return % while still working.
- retReturn: nominal investment return % in retirement.
- inflation: %.
- investWithin: $/yr invested from WITHIN the spend budget.
- investExtra: $/yr invested ON TOP of spend.
- superContrib: net employer super contributions $/yr.
- retireAge: target retirement age.
- extraMonthly: extra monthly mortgage repayment in $.
- longevity: age to plan funds until.
- swr: safe withdrawal rate %.
- propGrowth: property growth % (real).

Guidance:
- Make reasonable, conservative estimates and state the key assumption. E.g. "drop to 3 days a week" ≈ income × 3/5, and superContrib scales with income the same way.
- Change ONLY what the request implies; leave everything else out so it stays as-is.
- Keep the explanation to 1–2 sentences, plain English.

Current values: ${JSON.stringify(current)}`;

  const result = query({
    prompt: `Change to model: ${phrase}`,
    options: {
      model: MODEL,
      systemPrompt: system,
      mcpServers: { [SERVER_NAME]: server },
      allowedTools: [fqn],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
        "Glob", "Grep", "WebSearch", "WebFetch", "Task", "TodoWrite",
      ],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 4,
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    },
  });

  for await (const message of result) {
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error("Claude couldn't model that — try rephrasing.");
    }
  }
  if (!captured) throw new Error("Claude couldn't model that — try rephrasing.");

  const changes: Partial<Record<WhatIfField, number>> = {};
  for (const f of WHATIF_FIELDS) {
    const v = (captured as Record<string, unknown>)[f];
    if (typeof v === "number" && isFinite(v)) changes[f] = v;
  }
  const explanation =
    typeof (captured as Record<string, unknown>).explanation === "string"
      ? ((captured as Record<string, unknown>).explanation as string)
      : "Applied the changes.";
  return { changes, explanation };
}
