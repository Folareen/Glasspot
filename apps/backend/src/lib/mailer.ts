import { Resend } from "resend";
import env from "@/config/env";

// Singleton Resend client (same pattern as config/redis.ts); Node's module cache ensures it's created once per process.
const resend = new Resend(env.RESEND_API_KEY);

/** Sends an email via Resend, from MAIL_FROM. */
export async function sendMail(options: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const { error } = await resend.emails.send({
    from: env.MAIL_FROM,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });

  if (error) {
    throw new Error(`Failed to send email via Resend: ${error.message}`);
  }
}
