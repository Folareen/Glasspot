// The one place amount parsing/formatting happens anywhere in the
// frontend (see docs/system-rules.md and docs/frontend-rules.md). The API
// now speaks naira "NN.NN" strings end to end — there is no kobo anywhere
// on the wire, so nothing here ever multiplies/divides by 100. Every form
// that collects an amount from a user must send exactly what the user
// typed, reshaped to isValidNairaString's "NN.NN" form via toNairaAmount
// before it goes in a request body.

const NAIRA_STRING_PATTERN = /^\d+\.\d{2}$/;

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

/** Formats a wire-format naira string ("100.50") for display as Nigerian currency ("₦100.50"), via Intl.NumberFormat — never dividing by 100, since the value is already naira. */
export function formatNaira(naira: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(naira));
}

// The two functions below exist only for lib/mock/store.tsx, which
// simulates the backend's own ledger balance tracking locally (adding a
// contribution to a pot's running balance, subtracting a payout, etc) —
// apps/web has no dependency on apps/backend, so this is a small
// intentional duplicate of that side's lib/money.ts kobo helpers, kept
// private to this mock-only use rather than exported as a general
// currency-math API for real UI code (see toNairaAmount/formatNaira above
// for that).

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

/** Adds two wire-format naira strings via kobo bigints, so lib/mock/store.tsx never touches float arithmetic on money — mirrors how the real backend accumulates balances in the ledger. */
export function addNaira(a: string, b: string): string {
  return koboToNairaString(nairaStringToKobo(a) + nairaStringToKobo(b));
}

/** Subtracts b from a (both wire-format naira strings) via kobo bigints, same rationale as addNaira. */
export function subtractNaira(a: string, b: string): string {
  return koboToNairaString(nairaStringToKobo(a) - nairaStringToKobo(b));
}
