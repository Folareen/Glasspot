import crypto from "crypto";

// users.passwordHash has no separate salt column, so the salt is embedded in the stored string as "salt:hash".
const KEY_LENGTH = 64;

/** Hashes a password with scrypt and a freshly generated random salt, returning them combined as "salt:hash". */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/** Checks a candidate password against a stored "salt:hash" string using a constant-time comparison. */
export function verifyPassword({
  candidatePassword,
  hash,
}: {
  candidatePassword: string;
  hash: string; // stored as "salt:hash"
}): boolean {
  const [salt, storedHash] = hash.split(":");
  if (!salt || !storedHash) return false;

  const candidateHash = crypto.scryptSync(candidatePassword, salt, KEY_LENGTH).toString("hex");

  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}