export class PotError extends Error {
  statusCode: number;
  /** Builds a pot-related error carrying the HTTP status to respond with (defaults to 400). */
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "PotError";
    this.statusCode = statusCode;
  }
}

export class PotNotFoundError extends PotError {
  /** Builds a 404 error for a pot that doesn't exist, or (per getViewablePotOrThrow) one the caller isn't allowed to see. */
  constructor(message = "Pot not found") {
    super(message, 404);
    this.name = "PotNotFoundError";
  }
}
