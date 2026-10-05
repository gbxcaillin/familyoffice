import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import Database from "better-sqlite3";
import path from "path";

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
