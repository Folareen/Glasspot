import { BrevoClient } from "@getbrevo/brevo";
import env from "@/config/env";

// Singleton client (same pattern as config/redis.ts); Node's module cache ensures it's created once per process.
const brevo = new BrevoClient({ apiKey: env.BREVO_API_KEY });

const MAIL_FROM_PATTERN = /^(.*)<(.+)>$/;

/** Parses the "Name <email>" MAIL_FROM format into Brevo's {name, email} sender shape. */
function parseSender(mailFrom: string): { name?: string; email: string } {
  const match = mailFrom.match(MAIL_FROM_PATTERN);
  if (!match) {
    return { email: mailFrom.trim() };
  }
  return { name: match[1].trim(), email: match[2].trim() };
}

/** Sends an email via Brevo's transactional email API, from MAIL_FROM. */
export async function sendMail(options: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  await brevo.transactionalEmails.sendTransacEmail({
    sender: parseSender(env.MAIL_FROM),
    to: [{ email: options.to }],
    subject: options.subject,
    textContent: options.text,
    htmlContent: options.html,
  });
}
