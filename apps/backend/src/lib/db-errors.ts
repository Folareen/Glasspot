/** Checks whether `err` is a Postgres unique-violation (23505), the standard lost-the-insert-race signal; checks both err.code and err.cause.code since Drizzle wraps the real Postgres error under `.cause`. */
export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error && (cause as { code?: string }).code === "23505";
}
