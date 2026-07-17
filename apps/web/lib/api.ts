import type {
  AddMemberResponse,
  Bank,
  BankLookupResult,
  ContributionResponse,
  CurrentUser,
  PendingMemberResponse,
  MemberResponse,
  MeTransaction,
  PayoutConfigInput,
  PayoutMode,
  PotMemberRole,
  PotResponse,
  PotType,
  RefundType,
  TransactionResponse,
} from "./types";

// The only place apps/web makes an HTTP call from client code — every call is same-origin, to a
// Next.js Route Handler under app/api/*, which is the only thing that ever talks to the real
// backend (see lib/server/backend-client.ts). Never fetch the backend's own origin directly from
// here — see docs/frontend-rules.md's auth/BFF notes.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// A 401 here means the proxy (app/api/[...path]/route.ts) already tried refreshing the session
// and it still failed — the refresh token itself is dead (expired past its 30-day lifetime,
// revoked, or the browser cleared cookies), not just the 15-minute access token. Before this
// existed, every caller just got a raw ApiError and rendered its own "something went wrong"/
// "authentication required" message forever: proxy.ts's middleware only redirects on the
// *initial* page load (and only checks cookie presence, not validity), so once a live SPA session
// hit this state there was no path back to /login short of a manual reload — see the bug report
// this was written for. Redirecting straight to /login here means every API caller gets this for
// free with no per-call handling. getMe() opts out via skipAuthRedirect since a 401 there is the
// normal, expected "not logged in yet" signal on first load, not a dead session mid-use.
//
// Guards against redirect nesting (a real incident this shipped with): window.location.href is a
// full page reload, which resets every JS module — a same-page "already redirecting" flag alone
// doesn't survive that, so if the /login page itself ever fires a 401 (e.g. a stray authenticated
// call from a shared layout), each redirect appended another ?redirect=%2Flogin%3Fredirect%3D...
// layer on top of the last one. Never redirect from /login itself, and only ever carry the
// current path forward, never one that's already a /login?redirect=... URL.
function redirectToLogin() {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname === "/login") return;
  window.location.href = `/login?redirect=${encodeURIComponent(pathname + search)}`;
}

async function apiFetch<T>(path: string, init?: RequestInit & { skipAuthRedirect?: boolean }): Promise<T> {
  const { skipAuthRedirect, ...requestInit } = init ?? {};
  const response = await fetch(`/api${path}`, {
    ...requestInit,
    headers: {
      "content-type": "application/json",
      ...requestInit.headers,
    },
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect) {
      redirectToLogin();
    }
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : "Something went wrong";
    throw new ApiError(message, response.status);
  }

  return body as T;
}

function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ---------- auth ----------

export function register(input: { email: string; username: string; password: string; fullName: string; phone?: string }) {
  return apiFetch<{ userId: string; email: string; message: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function verifyEmail(input: { email: string; code: string }) {
  return apiFetch<{ user: { id: string; email: string; username: string; fullName: string } }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<{ requiresOtp: true; userId: string; message: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function verifyLoginOtp(input: { email: string; code: string }) {
  return apiFetch<{ user: { id: string; email: string; username: string; fullName: string } }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resendOtp(input: { email: string; purpose: "signup_verification" | "login" | "password_reset" }) {
  return apiFetch<{ message: string }>("/auth/resend-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function forgotPassword(input: { email: string }) {
  return apiFetch<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resetPassword(input: { email: string; code: string; newPassword: string }) {
  return apiFetch<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout() {
  return apiFetch<{ message: string }>("/auth/logout", { method: "POST" });
}

// ---------- me ----------

export function getMe() {
  // skipAuthRedirect: a 401 here is the normal "not logged in yet" check on
  // mount, not a dead mid-session — see apiFetch's redirectToLogin comment.
  return apiFetch<CurrentUser>("/me", { skipAuthRedirect: true });
}

export function updateRefundProfile(input: { accountNumber: string; bankCode: string }) {
  return apiFetch<{ defaultRefundAccount: string | null; defaultRefundBank: string | null }>("/me/refund-profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getMyTransactions() {
  return apiFetch<MeTransaction[]>("/me/transactions");
}

// ---------- banks ----------

export function listBanks() {
  return apiFetch<{ banks: Bank[] }>("/banks");
}

export function lookupBankAccount(input: { accountNumber: string; bankCode: string }) {
  return apiFetch<BankLookupResult>("/banks/lookup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ---------- pots ----------

export type CreatePotInput = {
  title: string;
  description?: string;
  potType: PotType;
  refundType: RefundType;
  minContribution?: string;
  maxContribution?: string;
  goalAmount?: string;
  payoutMode: PayoutMode;
  payoutConfig: PayoutConfigInput;
};

export function createPot(input: CreatePotInput) {
  return apiFetch<PotResponse>("/pots", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listPots(params: { scope?: "public" | "mine"; q?: string } = {}) {
  const search = new URLSearchParams();
  if (params.scope) search.set("scope", params.scope);
  if (params.q) search.set("q", params.q);
  const query = search.toString();
  return apiFetch<PotResponse[]>(`/pots${query ? `?${query}` : ""}`);
}

export function getPot(potId: string) {
  return apiFetch<PotResponse>(`/pots/${potId}`);
}

export function updatePot(potId: string, patch: Partial<CreatePotInput>) {
  return apiFetch<PotResponse>(`/pots/${potId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function activatePot(potId: string) {
  return apiFetch<PotResponse>(`/pots/${potId}/activate`, { method: "POST" });
}

export function deletePot(potId: string) {
  return apiFetch<{ message: string }>(`/pots/${potId}`, { method: "DELETE" });
}

export function closePot(potId: string) {
  return apiFetch<PotResponse>(`/pots/${potId}/close`, { method: "POST" });
}

export function getPotMembers(potId: string) {
  return apiFetch<MemberResponse[]>(`/pots/${potId}/members`);
}

export function getPendingMembers(potId: string) {
  // skipAuthRedirect: this route is authenticate-gated (not optionalAuthenticate like the rest of
  // the pot-detail reads), so a non-admin member gets an expected 403 but a fully anonymous
  // visitor to a public pot gets a 401 here — the caller (pots/[id]/page.tsx) already treats
  // either as "just show members without pending rows," it must not also redirect the anonymous
  // visitor to /login for a call they never needed to succeed.
  return apiFetch<PendingMemberResponse[]>(`/pots/${potId}/pending-members`, { skipAuthRedirect: true });
}

export function addMember(potId: string, input: { email: string; role?: PotMemberRole }) {
  return apiFetch<AddMemberResponse>(`/pots/${potId}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMemberRole(potId: string, userId: string, role: PotMemberRole) {
  return apiFetch<MemberResponse>(`/pots/${potId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function removeMember(potId: string, userId: string) {
  return apiFetch<{ message: string }>(`/pots/${potId}/members/${userId}`, { method: "DELETE" });
}

export function removePendingMember(potId: string, pendingId: string) {
  return apiFetch<{ message: string }>(`/pots/${potId}/pending-members/${pendingId}`, { method: "DELETE" });
}

export function leavePot(potId: string) {
  return apiFetch<{ message: string }>(`/pots/${potId}/leave`, { method: "POST" });
}

export function getPotTransactions(potId: string) {
  return apiFetch<TransactionResponse[]>(`/pots/${potId}/transactions`);
}

export function contribute(potId: string, input: { amount: string; anonymous?: boolean; refundAccountNumber?: string; refundBankCode?: string }) {
  return apiFetch<ContributionResponse>(`/pots/${potId}/contributions`, {
    method: "POST",
    headers: { "Idempotency-Key": generateIdempotencyKey() },
    body: JSON.stringify(input),
  });
}

export function requestPayoutOtp(potId: string, input: { destinationAccount?: string; destinationBank?: string; amount?: string }) {
  return apiFetch<{ message: string }>(`/pots/${potId}/payout/otp`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function triggerPayout(
  potId: string,
  input: { destinationAccount?: string; destinationBank?: string; amount?: string; otpCode: string }
) {
  return apiFetch<void>(`/pots/${potId}/payout`, {
    method: "POST",
    headers: { "Idempotency-Key": generateIdempotencyKey() },
    body: JSON.stringify(input),
  });
}

export function requestRefundOtp(potId: string) {
  return apiFetch<{ message: string }>(`/pots/${potId}/refund/otp`, { method: "POST" });
}

export function triggerRefund(potId: string, input: { otpCode: string }) {
  return apiFetch<void>(`/pots/${potId}/refund`, {
    method: "POST",
    headers: { "Idempotency-Key": generateIdempotencyKey() },
    body: JSON.stringify(input),
  });
}
