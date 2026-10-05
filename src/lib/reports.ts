import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

export interface AgentAssistReport {
  feature: string; // e.g. "import-parse"
  fileName?: string;
  detectError?: string; // why the deterministic path failed
  resultKind?: string; // what Claude decided it was
  rowCount?: number; // rows Claude extracted
  note?: string; // Claude's own note, if any
  sample?: string; // a short excerpt of the input, for debugging
}

// Record a Claude assist in the DB so the owner can review which formats the
// built-in code couldn't handle (shown in Settings → Assist log) and improve
// the underlying parser. Never throws — the caller's main job (e.g. returning
// the import preview) must not be affected.
export function recordAgentAssist(db: Database.Database, report: AgentAssistReport): void {
  try {
    db.prepare(
      `INSERT INTO agent_reports
         (id, feature, file_name, detect_error, result_kind, row_count, note, sample, emailed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      `rpt_${randomUUID().slice(0, 8)}`,
      report.feature,
      report.fileName ?? null,
      report.detectError ?? null,
      report.resultKind ?? null,
      report.rowCount ?? null,
      report.note ?? null,
      report.sample ? report.sample.slice(0, 4000) : null
    );
  } catch (e) {
    console.error("Agent-assist report insert failed:", (e as Error).message);
  }
}
