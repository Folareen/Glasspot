
/**
 * Thrown for any failed Nomba API call - non-2xx HTTP responses and network
 * failures alike (network errors get status 0). `code` is Nomba's own error
 * code from the response body when available.
 */

export class NombaApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: unknown) {
    super(message);
    this.name = "NombaApiError";
  }
}