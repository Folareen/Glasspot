import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

const otpPurposeValues = [
  "signup_verification",
  "login",
  "password_reset",
] as const;

const registerSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email"),

  username: z
    .string()
    .min(1, "Username is required")
    .min(3, "Username must be at least 3 characters"),

  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),

  fullName: z
    .string()
    .min(1, "Full name is required"),

  phone: z.string().optional(),
});

const registerResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  message: z.string(),
});

const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "Code must be 6 digits"),
});

// Shared response shape for any flow that ends in a fresh token pair
// (verify-email, verify login OTP, refresh).
const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    username: z.string(),
    fullName: z.string(),
  }),
});

const resendOtpSchema = z.object({
  email: z.string().email(),
  purpose: z.enum(otpPurposeValues),
});

const resendOtpResponseSchema = z.object({
  message: z.string(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Login never returns tokens directly — password success just unlocks
// the OTP step.
const loginResponseSchema = z.object({
  requiresOtp: z.literal(true),
  userId: z.string().uuid(),
  message: z.string(),
});

const verifyLoginOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "Code must be 6 digits"),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

const refreshTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const logoutSchema = z.object({
  refreshToken: z.string(),
});

const messageResponseSchema = z.object({
  message: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "Code must be 6 digits"),
  newPassword: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyLoginOtpInput = z.infer<typeof verifyLoginOtpSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Response types — the wire contract, safe for apps/web to import directly.
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type AuthTokensResponse = z.infer<typeof authTokensSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;

export const { schemas: authSchemas, $ref } = buildJsonSchemas({
  registerSchema,
  registerResponseSchema,
  verifyEmailSchema,
  authTokensSchema,
  resendOtpSchema,
  resendOtpResponseSchema,
  loginSchema,
  loginResponseSchema,
  verifyLoginOtpSchema,
  refreshTokenSchema,
  refreshTokenResponseSchema,
  logoutSchema,
  messageResponseSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
});