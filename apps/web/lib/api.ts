import type {
  AddMemberResponse,
  Bank,
  BankLookupResult,
  ContributionResponse,
  CurrentUser,
  InviteResponse,
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
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
  return apiFetch<CurrentUser>("/me");
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

export function closePot(potId: string) {
  return apiFetch<PotResponse>(`/pots/${potId}/close`, { method: "POST" });
}

export function getPotMembers(potId: string) {
  return apiFetch<MemberResponse[]>(`/pots/${potId}/members`);
}

export function getPotInvites(potId: string) {
  return apiFetch<InviteResponse[]>(`/pots/${potId}/invites`);
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

export function cancelInvite(potId: string, inviteId: string) {
  return apiFetch<{ message: string }>(`/pots/${potId}/invites/${inviteId}`, { method: "DELETE" });
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
