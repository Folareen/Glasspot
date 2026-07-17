// The one place amount parsing/formatting happens anywhere in the
// frontend (see docs/system-rules.md and docs/frontend-rules.md). The API
// now speaks naira "NN.NN" strings end to end — there is no kobo anywhere
// on the wire, so nothing here ever multiplies/divides by 100. Every form
// that collects an amount from a user must send exactly what the user
// typed, reshaped to isValidNairaString's "NN.NN" form via toNairaAmount
// before it goes in a request body.

const NAIRA_STRING_PATTERN = /^\d+\.\d{2}$/;

// Mirrors apps/backend/src/lib/fees.ts — kept in sync by hand since apps/web has no dependency
// on apps/backend. Both are added on top of what the user intends to move, never deducted from
// it: a contribution costs the intended amount plus inboundFeeFor(amount) to send, and a
// payout/refund amount costs the pot the requested amount plus OUTBOUND_FEE.
export const OUTBOUND_FEE = "50.00";

/** True for a well-formed "NN.NN" naira string — exactly two decimal digits, no sign, no thousands separators. Matches the backend's nairaAmount schema (apps/backend/src/modules/pots/pots.schema.ts). */
export function isValidNairaString(value: string): boolean {
  return NAIRA_STRING_PATTERN.test(value);
}

/**
 * Reshapes a raw user-typed amount (e.g. "100", "100.5", "  50.00 ") into
 * the wire-format "NN.NN" naira string the API expects, or null if the
 * input isn't a valid non-negative amount. Splits on the decimal point and
 * pads/truncates the fractional part to exactly 2 digits as a string
 * operation, never via Number()/Math.round() on the combined value, so a
 * long decimal typed by mistake is truncated predictably instead of
 * silently rounding.
 */
export function toNairaAmount(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const kobo = (fractionPart + "00").slice(0, 2);
  return `${Number(wholePart)}.${kobo}`;
}

/**
 * Sanitizes raw keystrokes from an amount <Input type="text"> down to digits and at most one
 * decimal point, e.g. "10,0000" -> "100000", "12.5.6" -> "12.56". Every amount field in the app
 * uses type="text" (not type="number") for exactly this reason: a native type="number" input
 * silently resets its value to "" the instant an invalid character like a comma is typed — a real
 * incident where a user typing "100,000" out of habit ended up with a shorter, wrong number
 * because everything typed after the comma rebuilt from empty. type="text" never does that; this
 * function is what keeps the value numeric instead.
 */
export function sanitizeAmountInput(raw: string): string {
  const digitsAndDots = raw.replace(/[^\d.]/g, "");
  const [wholePart, ...rest] = digitsAndDots.split(".");
  return rest.length > 0 ? `${wholePart}.${rest.join("")}` : wholePart;
}

/** Formats a wire-format naira string ("100.50") for display as Nigerian currency ("₦100.50"), via Intl.NumberFormat — never dividing by 100, since the value is already naira. */
export function formatNaira(naira: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(naira));
}

/**
 * Converts a wire-format naira string ("100.50") to a plain JS number, for
 * the narrow cases that genuinely need one — an <Input type="number">'s
 * min/max attributes, or a `<` / `>` bound comparison against a user-typed
 * amount — rather than each component hand-rolling its own `Number(naira)`.
 * Not for display (use formatNaira/<Money>) or for arithmetic between two
 * naira values (use addNaira/subtractNaira, which stay in exact kobo
 * bigints); this is just the single sanctioned Number() conversion point
 * for wire naira strings, per docs/frontend-rules.md's "add it to
 * lib/money.ts, don't inline it" rule.
 */
export function nairaAmountToNumber(naira: string): number {
  return Number(naira);
}

// Kobo-bigint helpers, used by lib/mock/store.tsx's local ledger simulation and by inboundFeeFor below.

/** Converts a wire-format naira string ("100.50") to its exact kobo bigint (10050n) — see apps/backend/src/lib/money.ts's nairaStringToKobo for the split-and-combine rationale (no float arithmetic on money). */
function nairaStringToKobo(naira: string): bigint {
  const [nairaPart, koboPart = "00"] = naira.split(".");
  return BigInt(nairaPart) * 100n + BigInt(koboPart.padEnd(2, "0").slice(0, 2));
}

/** Converts a kobo bigint back to its wire-format naira string — the exact inverse of nairaStringToKobo, via integer division/modulo rather than a float divide. */
function koboToNairaString(kobo: bigint): string {
  const negative = kobo < 0n;
  const absKobo = negative ? -kobo : kobo;
  const nairaPart = absKobo / 100n;
  const koboPart = absKobo % 100n;
  return `${negative ? "-" : ""}${nairaPart}.${koboPart.toString().padStart(2, "0")}`;
}

/** Adds two wire-format naira strings via kobo bigints, so callers never touch float arithmetic on money — mirrors how the real backend accumulates balances in the ledger. */
export function addNaira(a: string, b: string): string {
  return koboToNairaString(nairaStringToKobo(a) + nairaStringToKobo(b));
}

/** Subtracts b from a (both wire-format naira strings) via kobo bigints, same rationale as addNaira. */
export function subtractNaira(a: string, b: string): string {
  return koboToNairaString(nairaStringToKobo(a) - nairaStringToKobo(b));
}

// Mirrors apps/backend/src/lib/fees.ts's nombaInboundFeeFor/inboundFeeFor — a live preview only, the backend recomputes and charges the authoritative fee at contribution-creation time.
const NOMBA_INBOUND_FEE_MIN = "10.00";
const NOMBA_INBOUND_FEE_MAX = "150.00";
const PLATFORM_INBOUND_FEE = "10.00";

/** The Nomba-only slice of the inbound fee for a given intended (wire-format naira) contribution amount. */
export function nombaInboundFeeFor(intendedNaira: string): string {
  const intended = nairaStringToKobo(intendedNaira);
  const min = nairaStringToKobo(NOMBA_INBOUND_FEE_MIN);
  const max = nairaStringToKobo(NOMBA_INBOUND_FEE_MAX);
  const raw = (intended * 100n) / 10_000n;
  const clamped = raw < min ? min : raw > max ? max : raw;
  return koboToNairaString(clamped);
}

/** Total inbound fee (Nomba's variable cut + the platform's flat ₦10) for a given intended contribution amount — what ContributeModal adds on top of the amount the user typed. */
export function inboundFeeFor(intendedNaira: string): string {
  return addNaira(nombaInboundFeeFor(intendedNaira), PLATFORM_INBOUND_FEE);
}
