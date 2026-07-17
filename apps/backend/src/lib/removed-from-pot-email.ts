/** Shared HTML/text template sent when an admin removes someone from a pot (PotMembersService.remove) — mirrors added-to-pot-email.ts's structure. Not sent when a member leaves of their own accord (they already know), see the `notify` flag on remove(). */
export function removedFromPotEmail(options: { potTitle: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const { potTitle } = options;

  const subject = `You've been removed from "${potTitle}" on Glasspot`;

  const text = `You've been removed from the pot "${potTitle}" on Glasspot.\n\nYou no longer have access to this pot and won't be able to contribute or see updates unless added again.\n\nGlasspot`;

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
                  You've been removed from <strong>${potTitle}</strong> on Glasspot.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">
                  You no longer have access to this pot and won't be able to contribute or see
                  updates unless added again.
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
