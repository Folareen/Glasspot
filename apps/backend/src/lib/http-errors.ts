import { FastifyReply, FastifyRequest, FastifySchemaValidationError } from "fastify";
import { NombaApiError } from "@/integrations/nomba/nomba.error";
import { PotError } from "@/modules/pots/pots.errors";
import { AuthError } from "@/modules/auth/auth.errors";
import { LedgerError } from "@/modules/ledger/ledger.errors";
import {
  IdempotencyKeyReuseError,
  IdempotencyInProgressError,
  IdempotencyIndeterminateError,
} from "@/lib/idempotency.service";
import { AccountVerificationError } from "@/integrations/nomba/verify-account-details";

/**
 * The one place a thrown error becomes an HTTP response, used by every controller's catch block
 * and by app.ts's setErrorHandler as the last-resort net for anything a controller forgot to
 * catch. A "safe" error is an instance of one of this codebase's own domain error hierarchies
 * (PotError/AuthError/LedgerError and their subclasses, plus the handful of other hand-authored
 * error classes below) — deliberately instanceof, not a structural "has a numeric statusCode"
 * duck-type check: a third-party SDK error (e.g. Brevo's mail client, which is Axios-based and
 * carries its own numeric status-shaped fields) can accidentally match a loose shape check and
 * leak its raw message/status to a client — this happened once already (a failed transactional
 * email surfaced as a 401 "unauthorized" instead of a 500). `message` on a safe error is always
 * hand-authored copy from the throwing code, so it's sent to the client as-is; anything else (a
 * raw NombaApiError, a ZodError, a Postgres error, a third-party SDK error, a plain bug) is logged
 * in full server-side and replaced with a generic message before it reaches the client — third-party
 * vendor text, ORM/DB internals, and stack-shaped strings are never authored for end users and must
 * never be sent to one (see docs/backend-rules.md, docs/system-rules.md's no-silent-failures rule).
 */
export function sendErrorResponse(e: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (isSafeError(e)) {
    const reply2 = "retryAfterSeconds" in e && typeof e.retryAfterSeconds === "number" ? reply.header("Retry-After", e.retryAfterSeconds) : reply;
    return reply2.code(e.statusCode).send({ message: e.message });
  }

  // NombaApiError carries `status`, not `statusCode` (see nomba.error.ts) — deliberately not
  // treated as a "safe" error above, since its message is Nomba's own raw vendor response text,
  // never authored for end users. Logged in full (status/code/body included) so the actual vendor
  // response is still visible in logs for debugging, but the client only ever gets a generic 502.
  if (e instanceof NombaApiError) {
    request.log.error({ err: e, nombaStatus: e.status, nombaCode: e.code, nombaBody: e.body }, "Unhandled NombaApiError");
    return reply.code(502).send({ message: "We couldn't reach our payments provider. Please try again shortly." });
  }

  request.log.error({ err: e }, "Unhandled error");
  return reply.code(500).send({ message: "Something went wrong. Please try again." });
}

/**
 * True for an instance of one of this codebase's own domain error classes, OR a Fastify schema
 * validation error — see this function's home (sendErrorResponse)'s doc comment for why domain
 * errors are checked via instanceof rather than a structural "has a numeric statusCode" check.
 * Schema validation errors are the one deliberate exception: Fastify attaches `validation` (the
 * raw AJV issue array) to every error it builds from `schemaErrorFormatter`'s return value (see
 * fastify/lib/validation.js's wrapValidationError) — checking for that array specifically (rather
 * than the same broad "has a statusCode" check that caused the mailer-error regression this
 * function's doc comment describes) still narrowly targets only what Fastify itself produced, not
 * any error that happens to duck-type the same way.
 * WebhookVerificationError is deliberately excluded — it carries no statusCode of its own (the
 * webhook route hardcodes 401 itself, see nomba-webhooks.route.ts) and is never routed through
 * sendErrorResponse in the first place.
 */
function isSafeError(e: unknown): e is Error & { statusCode: number; retryAfterSeconds?: number } {
  return (
    e instanceof PotError ||
    e instanceof AuthError ||
    e instanceof LedgerError ||
    e instanceof IdempotencyKeyReuseError ||
    e instanceof IdempotencyInProgressError ||
    e instanceof IdempotencyIndeterminateError ||
    e instanceof AccountVerificationError ||
    (e instanceof Error && Array.isArray((e as { validation?: unknown }).validation) && typeof (e as { statusCode?: unknown }).statusCode === "number")
  );
}

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  minContribution: "minimum contribution",
  maxContribution: "maximum contribution",
  goalAmount: "goal amount",
  targetAmount: "target amount",
  destinationAccount: "destination account number",
  destinationBank: "destination bank",
};

/** "camelCaseWord" -> "camel case word", so an un-overridden field name still reads as English rather than raw code, in the fallback branch below. */
function humanizeFieldName(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Fastify's/AJV's own instancePath is a JSON-pointer fragment like "/body/minContribution" or "" for the root — this strips the leading dataVar segment and any leading slash, leaving just the field name (or "" for a root-level error, e.g. a missing required property named in `params.missingProperty` instead). */
function fieldNameFromInstancePath(instancePath: string): string {
  return instancePath.replace(/^\//, "").split("/").slice(1).join(".");
}

// AJV keywords that never carry useful field-level information on their own — a discriminated
// union (this API's payoutConfig/payoutMode pairing, validated as JSON Schema `anyOf`) makes AJV
// emit one "must be equal to constant"/"must match a schema in anyOf" error per rejected branch
// PLUS the real, specific error inside whichever branch actually matched the caller's intent
// (e.g. a "pattern" failure on the field that's actually wrong). Surfacing the branch-rejection
// noise alongside the real error reads as "must be equal to constant; must be equal to constant;
// ...; body: must match a schema in anyOf" — worse than no formatting at all. Dropped entirely
// here; the specific, field-level errors from inside the matching branch still come through.
const NOISE_KEYWORDS = new Set(["anyOf", "oneOf", "const"]);

/**
 * Fastify's own AJV validation errors are technical by design (e.g. `must match pattern
 * "^\d+\.\d{2}$"`, `must have required property 'password'`) — this reshapes each one into a
 * single readable sentence per field, wired in as app.ts's `schemaErrorFormatter`. Not a full
 * per-keyword translation table (AJV has dozens of keywords); covers the handful that actually
 * show up in this API's schemas (required/type/pattern/format/minimum/maximum/enum) and falls back
 * to AJV's own message, humanized, for anything else — still far more readable than the raw
 * instancePath-prefixed original, never silently swallowed. Deduped and filtered (see
 * NOISE_KEYWORDS) so a discriminated-union schema's per-branch rejection noise doesn't repeat the
 * same sentence several times over.
 */
export function formatSchemaErrors(errors: FastifySchemaValidationError[], dataVar: string): Error {
  const sentences = new Set<string>();

  for (const err of errors) {
    if (NOISE_KEYWORDS.has(err.keyword)) continue;

    const rawField =
      err.keyword === "required"
        ? String((err.params as { missingProperty?: string }).missingProperty ?? "")
        : fieldNameFromInstancePath(err.instancePath);
    const field = FIELD_LABEL_OVERRIDES[rawField] ?? (rawField ? humanizeFieldName(rawField) : dataVar);

    switch (err.keyword) {
      case "required":
        sentences.add(`${field} is required`);
        break;
      case "type":
        sentences.add(`${field} has the wrong type`);
        break;
      case "pattern":
      case "format":
        sentences.add(`${field} is not in a valid format`);
        break;
      case "minimum":
      case "exclusiveMinimum":
      case "maximum":
      case "exclusiveMaximum":
        sentences.add(`${field} is out of the allowed range`);
        break;
      case "enum":
        sentences.add(`${field} is not one of the allowed values`);
        break;
      default:
        sentences.add(`${field}: ${err.message ?? "is invalid"}`);
    }
  }

  if (sentences.size === 0) {
    // Every error was filtered as noise (e.g. a discriminated union rejected on `const` alone,
    // with no deeper field-level error inside any branch — a wrong payoutMode value itself,
    // rather than a malformed payoutConfig) — fall back to naming the field generically rather
    // than sending an empty message.
    return new Error(`${dataVar} does not match the expected shape`);
  }

  return new Error([...sentences].join("; "));
}
