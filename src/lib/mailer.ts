import nodemailer, { type Transporter } from "nodemailer";

// Simple SMTP mailer for operational reports (e.g. "Claude had to rescue an
// import"). Configured entirely by environment so no creds live in the repo.
// If SMTP isn't set up, sendMail() returns { sent:false } rather than throwing —
// callers treat email as best-effort and rely on the DB record for durability.
//
// Env:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
//   SMTP_SECURE ("true" for port 465 TLS)
//   MAIL_FROM   (e.g. "Family Office <noreply@gbxps.com>")

export function mailerConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

let cached: Transporter | null = null;
function transport(): Transporter {
  if (!cached) {
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  }
  return cached;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!mailerConfigured()) {
    return { sent: false, reason: "SMTP not configured" };
  }
  try {
    await transport().sendMail({
      from: process.env.MAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
