export class LedgerError extends Error {
  statusCode: number;
  /** Builds a ledger-related error carrying the HTTP status to respond with (defaults to 400). */
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "LedgerError";
    this.statusCode = statusCode;
  }
}

/** Thrown when a caller passes entries whose debits and credits don't sum to zero — never allowed to reach the DB. */
export class UnbalancedTransactionError extends LedgerError {
  constructor(message = "Transaction entries are not balanced: debits must equal credits") {
    super(message, 400);
    this.name = "UnbalancedTransactionError";
  }
}

/** Thrown when `reference` already exists — the caller should treat this as an idempotent replay, not a hard failure, at the call site. `reference` is an internal idempotency key, not authored for display, so it's kept off the client-facing message and only attached as `.reference` for logging. */
export class DuplicateTransactionReferenceError extends LedgerError {
  reference: string;
  constructor(reference: string) {
    super("A transaction with this reference already exists", 409);
    this.name = "DuplicateTransactionReferenceError";
    this.reference = reference;
  }
}

/** Thrown when posting an entry would take an account's balance negative in its own normal-balance direction — never allowed to reach the DB, since every account here represents real (or real-adjacent) money that can't go below zero. `accountId` is an internal ledger account UUID, not authored for display, so it's kept off the client-facing message and only attached as `.accountId` for logging. */
export class InsufficientBalanceError extends LedgerError {
  accountId: string;
  constructor(accountId: string) {
    super("This account does not have sufficient balance for this operation", 409);
    this.name = "InsufficientBalanceError";
    this.accountId = accountId;
  }
}
