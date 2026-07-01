


export class NombaApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}