import env from "@/config/env";

/** Shared HTML/text template sent when an admin adds someone to a pot by email (PendingMembersService.create) — not an invite to accept/decline, they're already a member (or will be automatically once they sign up), this just points them at the pot. */
export function addedToPotEmail(options: { potTitle: string; potId: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const { potTitle, potId } = options;
  const potUrl = `${env.WEB_ORIGIN}/pots/${potId}`;

  const subject = `You've been added to "${potTitle}" on Glasspot`;

  const text = `You've been added to the pot "${potTitle}" on Glasspot.\n\nIf you don't have a Glasspot account yet, sign up with this email address and you'll be added automatically once you verify it.\n\nView the pot: ${potUrl}\n\nGlasspot`;

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">Glasspot</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0;font-size:15px;line-height:22px;color:#374151;">
                  You've been added to <strong>${potTitle}</strong> on Glasspot.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">
                  If you don't have a Glasspot account yet, sign up with this email address and
                  you'll be added automatically once you verify it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;" align="center">
                <a href="${potUrl}" style="display:inline-block;background-color:#0f6e5f;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">
                  View pot
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#9ca3af;word-break:break-all;">
                  ${potUrl}
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:12px;color:#9ca3af;">Glasspot &middot; this is an automated message, please don't reply.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  return { subject, text, html };
}
