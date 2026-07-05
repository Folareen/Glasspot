export class AuthError extends Error {
  statusCode: number;
  /** Builds an auth-related error carrying the HTTP status to respond with (defaults to 400). */
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export class RateLimitError extends AuthError {
  retryAfterSeconds: number;
  /** Builds a 429 error carrying how many seconds the caller should wait before retrying (used to set the Retry-After header). */
  constructor(message: string, retryAfterSeconds: number) {
    super(message, 429);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}