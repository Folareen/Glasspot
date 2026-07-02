/**
 * Checks whether `err` is a Postgres unique-violation (error code 23505),
 * the standard "lost the insert race to a concurrent caller" signal used
 * throughout this codebase's get-or-create / dedupe-by-insert patterns.
 *
 * Checks err.code directly AND err.cause.code — Drizzle wraps the
 * underlying postgres.js error in its own DrizzleQueryError, which puts
 * the real Postgres error code on `.cause`, not the top-level error
 * object. A bare `(err as { code?: string }).code === "23505"` check
 * (the pattern this replaces) silently never matches against a real
 * Drizzle-thrown error and lets the race condition it was meant to catch
 * escape as an unhandled exception instead.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error && (cause as { code?: string }).code === "23505";
}
