export class PotError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "PotError";
    this.statusCode = statusCode;
  }
}

export class PotNotFoundError extends PotError {
  constructor(message = "Pot not found") {
    super(message, 404);
    this.name = "PotNotFoundError";
  }
}
