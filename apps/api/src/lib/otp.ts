import crypto from "crypto";

const OTP_LENGTH = 6;

/** Cryptographically random 6-digit code, zero-padded (e.g. "004821"). */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(OTP_LENGTH, "0");
}

export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function verifyOtpCode(code: string, hash: string): boolean {
  const candidateHash = hashOtpCode(code);
  const a = Buffer.from(candidateHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}