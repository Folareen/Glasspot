// The only naira-string <-> kobo-bigint conversion in the backend (docs/system-rules.md).
// Every wire boundary must go through these two functions, never inline Number()/Math.round()
// arithmetic — that risks float representation error; these split on the decimal point and
// parse each part as a plain integer instead.

const NAIRA_STRING_PATTERN = /^\d+\.\d{2}$/;

/** True for a well-formed "NN.NN" naira string — exactly two decimal digits, no sign, no thousands separators. Use as the zod refinement backing nairaAmountSchema. */
export function isValidNairaString(value: string): boolean {
  return NAIRA_STRING_PATTERN.test(value);
}

/** Converts a wire-format naira string ("100.50") to its exact kobo bigint (10050n); throws unless the input is already a valid "NN.NN" string. */
export function nairaStringToKobo(naira: string): bigint {
  if (!isValidNairaString(naira)) {
    throw new Error(`nairaStringToKobo: "${naira}" is not a valid "NN.NN" naira string`);
  }
  const [nairaPart, koboPart] = naira.split(".");
  return BigInt(nairaPart) * 100n + BigInt(koboPart);
}

/** Converts a kobo bigint (10050n) to its wire-format naira string ("100.50"), the exact inverse of nairaStringToKobo. */
export function koboToNairaString(kobo: bigint): string {
  const negative = kobo < 0n;
  const absKobo = negative ? -kobo : kobo;
  const nairaPart = absKobo / 100n;
  const koboPart = absKobo % 100n;
  const sign = negative ? "-" : "";
  return `${sign}${nairaPart}.${koboPart.toString().padStart(2, "0")}`;
}
