import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { sendMail, mailerConfigured } from "@/lib/mailer";

// Where operational reports go. Defaults to the owner's address; override with
// REPORT_EMAIL if needed.
const REPORT_TO = process.env.REPORT_EMAIL || "cc@gbxps.com";

export interface AgentAssistReport {
  feature: string; // e.g. "import-parse"
  fileName?: string;
  detectError?: string; // why the deterministic path failed
  resultKind?: string; // what Claude decided it was
  rowCount?: number; // rows Claude extracted
  note?: string; // Claude's own note, if any
  sample?: string; // a short excerpt of the input, for debugging
}

// Record the assist in the DB (durable, never lost) and best-effort email a
// report to the owner so they can harden the underlying code. Never throws —
// the caller's main job (e.g. returning the import preview) must not be affected.
export async function recordAgentAssist(
  db: Database.Database,
  report: AgentAssistReport
): Promise<void> {
  const id = `rpt_${randomUUID().slice(0, 8)}`;
  const sample = report.sample ? report.sample.slice(0, 4000) : null;

  const subject = `[Family Office] Claude assisted: ${report.feature}${
    report.fileName ? ` — ${report.fileName}` : ""
  }`;
  const body = [
    `The app needed Claude to complete a task the built-in code couldn't handle.`,
    `This is a signal to add/adjust a deterministic parser so it isn't needed next time.`,
    ``,
    `Feature:        ${report.feature}`,
    `File:           ${report.fileName ?? "(none)"}`,
    `Auto-detect:    ${report.detectError ?? "(not provided)"}`,
    `Claude read as: ${report.resultKind ?? "(unknown)"}`,
    `Rows extracted: ${report.rowCount ?? 0}`,
    report.note ? `Claude note:    ${report.note}` : null,
    ``,
    `--- input sample (first lines) ---`,
    sample ?? "(none)",
  ]
    .filter((l) => l !== null)
    .join("\n");

  let emailed = 0;
  try {
    if (mailerConfigured()) {
      const res = await sendMail({ to: REPORT_TO, subject, text: body });
      emailed = res.sent ? 1 : 0;
      if (!res.sent) console.error("Agent-assist report email failed:", res.reason);
    } else {
      console.warn("Agent-assist report not emailed (SMTP not configured):", subject);
    }
  } catch (e) {
    console.error("Agent-assist report email threw:", (e as Error).message);
  }

  try {
    db.prepare(
      `INSERT INTO agent_reports
         (id, feature, file_name, detect_error, result_kind, row_count, note, sample, emailed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      report.feature,
      report.fileName ?? null,
      report.detectError ?? null,
      report.resultKind ?? null,
      report.rowCount ?? null,
      report.note ?? null,
      sample,
      emailed
    );
  } catch (e) {
    console.error("Agent-assist report DB insert failed:", (e as Error).message);
  }
}
