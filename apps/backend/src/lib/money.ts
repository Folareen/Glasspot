/**
 * The one place naira-string <-> kobo-bigint conversion happens anywhere
 * in the backend (see docs/system-rules.md). Every wire boundary — request
 * body validation, response serialization — must go through these two
 * functions, never inline arithmetic on a naira value.
 *
 * Deliberately no Number()/parseFloat()/Math.round() on the combined
 * value: floating point can misrepresent a value like 19.999999999998 for
 * an input that should be exact, and money must never touch float
 * arithmetic (docs/system-rules.md). Instead the naira and kobo parts are
 * split on the decimal point as strings first, each parsed as an integer
 * independently, then combined with plain bigint arithmetic.
 */

const NAIRA_STRING_PATTERN = /^\d+\.\d{2}$/;

/** True for a well-formed "NN.NN" naira string — exactly two decimal digits, no sign, no thousands separators. Use as the zod refinement backing nairaAmountSchema. */
export function isValidNairaString(value: string): boolean {
  return NAIRA_STRING_PATTERN.test(value);
}

/**
 * Converts a wire-format naira string ("100.50") to its exact kobo bigint
 * (10050n). Splits on the decimal point first — the naira part and kobo
 * part are each parsed as plain integers, then combined as
 * nairaPart * 100n + koboPart, so the result is always exact regardless of
 * how many trailing/leading digits are involved. Throws if the input isn't
 * exactly "digits.digits{2}" (validate with isValidNairaString / the zod
 * schema before calling, so this only ever runs on an already-shaped value).
 */
export function nairaStringToKobo(naira: string): bigint {
  if (!isValidNairaString(naira)) {
    throw new Error(`nairaStringToKobo: "${naira}" is not a valid "NN.NN" naira string`);
  }
  const [nairaPart, koboPart] = naira.split(".");
  return BigInt(nairaPart) * 100n + BigInt(koboPart);
}

/**
 * Converts a kobo bigint (10050n) back to its wire-format naira string
 * ("100.50") — the exact inverse of nairaStringToKobo, via integer
 * division/modulo rather than dividing by 100 as a float. koboPart is
 * always padded to 2 digits (e.g. 5n -> "05") so the result always has
 * exactly two decimal places.
 */
export function koboToNairaString(kobo: bigint): string {
  const negative = kobo < 0n;
  const absKobo = negative ? -kobo : kobo;
  const nairaPart = absKobo / 100n;
  const koboPart = absKobo % 100n;
  const sign = negative ? "-" : "";
  return `${sign}${nairaPart}.${koboPart.toString().padStart(2, "0")}`;
}
