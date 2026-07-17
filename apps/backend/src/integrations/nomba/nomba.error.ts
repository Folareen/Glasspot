
/** Thrown for any failed Nomba API call — non-2xx responses and network failures alike (network errors get status 0); `code` is Nomba's own error code from the response body when available. */
export class NombaApiError extends Error {
  /** Builds a normalized error from a failed Nomba API call, carrying the HTTP status (0 for network failures), Nomba's own error code if available, and the raw response body. */
  constructor(message: string, public status: number, public code?: string, public body?: unknown) {
    super(message);
    this.name = "NombaApiError";
  }
}

/**
 * Thrown by NombaClient.handleWebhook itself for a malformed/unauthenticated inbound request
 * (missing headers, invalid JSON, bad signature, missing requestId) — distinct from an error
 * thrown by the caller-supplied handler, which means the request was genuinely from Nomba but our
 * own processing of it failed. The public webhook route uses this distinction to respond 401 with
 * a safe generic message for this class, vs. 500 with no message leak for anything else, so an
 * internal DB/service failure downstream of a valid signature never gets reported back to the
 * caller as a raw error string, and never gets mislabeled as an auth failure either.
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}