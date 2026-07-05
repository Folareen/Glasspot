import nodemailer from "nodemailer";
import env from "@/config/env";

/**
 * Singleton SMTP transporter, initialized from env.ts — same pattern as
 * config/redis.ts. Import `sendMail` anywhere email delivery is needed;
 * Node's module cache ensures the underlying connection pool is only
 * created once per process.
 */
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
});

/** Sends an email via the configured SMTP transport, from MAIL_FROM. */
export async function sendMail(options: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}
