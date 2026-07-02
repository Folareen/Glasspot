export class LedgerError extends Error {
  statusCode: number;
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

/** Thrown when `reference` already exists — the caller should treat this as an idempotent replay, not a hard failure, at the call site. */
export class DuplicateTransactionReferenceError extends LedgerError {
  constructor(reference: string) {
    super(`A transaction with reference '${reference}' already exists`, 409);
    this.name = "DuplicateTransactionReferenceError";
  }
}
