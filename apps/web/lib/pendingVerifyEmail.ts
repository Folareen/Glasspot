// Holds the email a user just logged in / signed up with so the OTP verify
// step can show and use it without putting it in the URL, where it would
// leak into browser history, server access logs, and Referer headers.
// sessionStorage (not localStorage) — it's only needed for the current
// verify flow, not across future visits.
const PENDING_VERIFY_EMAIL_KEY = "glasspot:pending-verify-email";

export function setPendingVerifyEmail(email: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_VERIFY_EMAIL_KEY, email);
}

export function getPendingVerifyEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(PENDING_VERIFY_EMAIL_KEY);
}

export function clearPendingVerifyEmail(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_VERIFY_EMAIL_KEY);
}
