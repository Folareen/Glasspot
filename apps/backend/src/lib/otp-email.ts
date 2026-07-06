/** Shared HTML/text template for one-time code emails (signup, login, password reset, payout/refund confirmation); the code is deliberately kept out of the subject line, a common phishing tell on lock screens. */
export function otpEmail(options: { code: string; intro: string; ttlMinutes: number }): {
  subject: string;
  text: string;
  html: string;
} {
  const { code, intro, ttlMinutes } = options;

  const subject = "Your Glasspot verification code";

  const text = `${intro}\n\nYour code: ${code}\n\nThis code expires in ${ttlMinutes} minutes and can only be used once.\n\nIf you didn't request this, you can safely ignore this email — your account is still secure.\n\nGlasspot`;

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
                <p style="margin:0;font-size:15px;line-height:22px;color:#374151;">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;" align="center">
                <div style="background-color:#f4f5f7;border-radius:8px;padding:16px 24px;display:inline-block;">
                  <span style="font-size:28px;font-weight:700;letter-spacing:4px;color:#111827;">${code}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">
                  This code expires in ${ttlMinutes} minutes and can only be used once.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#9ca3af;">
                  Didn't request this? You can safely ignore this email — your account is still secure.
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
