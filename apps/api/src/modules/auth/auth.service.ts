import { and, desc, eq, gte, isNull } from "drizzle-orm";
import db, { otpCodes, users } from "@glasspot/db";
import { hashPassword, verifyPassword } from "@/lib/hash";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@/lib/otp";
import { hashToken, signRefreshToken, verifyRefreshTokenSignature } from "@/lib/tokens";
import { AuthError, RateLimitError } from "./auth.errors";
import { RegisterInput } from "./auth.schema";

type OtpPurposeValue = "signup_verification" | "login" | "password_reset";

// A function the controller hands in that wraps request.jwt.sign — keeps
// this service free of any Fastify request/reply coupling.
type SignFn = (payload: object) => string;

// ---- tunables ----
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;

function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

async function assertOtpNotRateLimited(userId: string, purpose: OtpPurposeValue) {
  const [latest] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (latest) {
    const secondsSinceLast = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new RateLimitError(
        "Please wait before requesting another code",
        Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)
      );
    }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCodes = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.purpose, purpose),
        gte(otpCodes.createdAt, oneHourAgo)
      )
    );

  if (recentCodes.length >= OTP_MAX_PER_HOUR) {
    throw new RateLimitError("Too many codes requested. Try again later.", 60 * 60);
  }
}

async function createOtp(userId: string, purpose: OtpPurposeValue) {
  await assertOtpNotRateLimited(userId, purpose);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);

  await db.insert(otpCodes).values({
    userId,
    purpose,
    codeHash,
    expiresAt: otpExpiry(),
  });

  // TODO: swap for real email delivery. Logging keeps the flow testable
  // end to end without a mail provider wired up yet.
  console.log(`[otp] ${purpose} code for user ${userId}: ${code}`);

  return code;
}

async function verifyOtp(userId: string, purpose: OtpPurposeValue, code: string) {
  const [otp] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.purpose, purpose),
        isNull(otpCodes.consumedAt)
      )
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!otp) {
    throw new AuthError("No active code found. Request a new one.", 400);
  }

  if (otp.expiresAt.getTime() < Date.now()) {
    throw new AuthError("Code has expired. Request a new one.", 400);
  }

  if (otp.attemptCount >= otp.maxAttempts) {
    throw new AuthError("Too many incorrect attempts. Request a new code.", 429);
  }

  const isValid = verifyOtpCode(code, otp.codeHash);

  if (!isValid) {
    await db
      .update(otpCodes)
      .set({ attemptCount: otp.attemptCount + 1 })
      .where(eq(otpCodes.id, otp.id));
    throw new AuthError("Incorrect code", 400);
  }

  await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));
}

function toPublicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
  };
}

async function issueTokenPair(userId: string, sign: SignFn) {
  const { token: refreshToken, jti, expiresAt } = signRefreshToken(userId);

  await db
    .update(users)
    .set({
      refreshTokenHash: hashToken(jti),
      refreshTokenExpiresAt: expiresAt,
    })
    .where(eq(users.id, userId));

  const accessToken = sign({ sub: userId });

  return { accessToken, refreshToken };
}

export const AuthService = {
  async register(input: RegisterInput) {
    const existing = await db.query.users.findFirst({
      where: (u, { or, eq: eqOp }) => or(eqOp(u.email, input.email), eqOp(u.username, input.username)),
    });
    if (existing) {
      throw new AuthError("Email or username already in use", 409);
    }

    const passwordHash = hashPassword(input.password);

    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        username: input.username,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone,
      })
      .returning();

    await createOtp(user.id, "signup_verification");

    return { userId: user.id, email: user.email };
  },

  async resendOtp(email: string, purpose: OtpPurposeValue) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      // Don't reveal whether the email exists — caller always gets a
      // generic "if the account exists" success response.
      return;
    }
    if (purpose === "signup_verification" && user.emailVerifiedAt) {
      throw new AuthError("Email is already verified", 400);
    }
    await createOtp(user.id, purpose);
  },

  async verifyEmail(email: string, code: string, sign: SignFn) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      throw new AuthError("Invalid email or code", 400);
    }
    if (user.emailVerifiedAt) {
      throw new AuthError("Email is already verified", 400);
    }

    await verifyOtp(user.id, "signup_verification", code);

    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));

    const tokens = await issueTokenPair(user.id, sign);
    return { ...tokens, user: toPublicUser(user) };
  },

  async login(email: string, password: string) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      throw new AuthError("Invalid email or password", 401);
    }

    const isValid = verifyPassword({ candidatePassword: password, hash: user.passwordHash });
    if (!isValid) {
      throw new AuthError("Invalid email or password", 401);
    }

    if (isValid && !user.emailVerifiedAt) {
      throw new AuthError("Please verify your email before logging in", 403);
    }

    await createOtp(user.id, "login");

    return { userId: user.id };
  },

  async verifyLoginOtp(email: string, code: string, sign: SignFn) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      throw new AuthError("Invalid email or code", 400);
    }

    await verifyOtp(user.id, "login", code);

    const tokens = await issueTokenPair(user.id, sign);
    return { ...tokens, user: toPublicUser(user) };
  },

  async refresh(presentedToken: string, sign: SignFn) {
    let payload;
    try {
      payload = verifyRefreshTokenSignature(presentedToken);
    } catch {
      throw new AuthError("Invalid or expired refresh token", 401);
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new AuthError("Session no longer valid", 401);
    }

    if (user.refreshTokenExpiresAt.getTime() < Date.now()) {
      throw new AuthError("Session expired, please log in again", 401);
    }

    const presentedHash = hashToken(payload.jti);

    if (presentedHash !== user.refreshTokenHash) {
      // Reuse detected: someone presented a refresh token that doesn't
      // match what's currently on file for this user (e.g. an old,
      // already-rotated-away token). Kill the session immediately rather
      // than silently rejecting — this is the signal a token was stolen.
      await db
        .update(users)
        .set({ refreshTokenHash: null, refreshTokenExpiresAt: null })
        .where(eq(users.id, user.id));
      throw new AuthError("Refresh token reuse detected, session revoked", 401);
    }

    return issueTokenPair(user.id, sign);
  },

  async logout(userId: string) {
    await db
      .update(users)
      .set({ refreshTokenHash: null, refreshTokenExpiresAt: null })
      .where(eq(users.id, userId));
  },
};