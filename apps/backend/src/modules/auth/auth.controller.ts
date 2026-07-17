import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import {
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  RefreshTokenInput,
  RegisterInput,
  ResendOtpInput,
  ResetPasswordInput,
  VerifyEmailInput,
  VerifyLoginOtpInput,
} from "./auth.schema";
import { sendErrorResponse as handleAuthError } from "@/lib/http-errors";

/** Registers a new account and responds 201 with the new userId/email plus an instruction to check email for the verification code. */
export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterInput }>,
  reply: FastifyReply
) {
  try {
    const { userId, email } = await AuthService.register(request.body);
    return reply.code(201).send({
      userId,
      email,
      message: "Account created. Check your email for a verification code.",
    });
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Confirms the signup verification code and responds with the issued token pair + public user, delegating signing to request.jwt via the sign callback. */
export async function verifyEmailHandler(
  request: FastifyRequest<{ Body: VerifyEmailInput }>,
  reply: FastifyReply
) {
  try {
    const sign = (payload: object) => request.jwt.sign(payload);
    const result = await AuthService.verifyEmail(request.body.email, request.body.code, sign);
    return reply.code(200).send(result);
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Triggers a new OTP send and always responds 200 with the same generic message, regardless of whether the email actually matched an account. */
export async function resendOtpHandler(
  request: FastifyRequest<{ Body: ResendOtpInput }>,
  reply: FastifyReply
) {
  try {
    await AuthService.resendOtp(request.body.email, request.body.purpose);
    // Always the same message, regardless of whether the email exists.
    return reply.code(200).send({ message: "If the account exists, a new code has been sent." });
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Verifies email/password and responds 200 with requiresOtp: true — this step alone never returns tokens. */
export async function loginHandler(
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply
) {
  try {
    const { userId } = await AuthService.login(request.body.email, request.body.password);
    return reply.code(200).send({
      requiresOtp: true,
      userId,
      message: "Enter the code sent to your email to finish logging in.",
    });
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Confirms the login OTP and responds with the issued token pair + public user, completing the login flow started by loginHandler. */
export async function verifyLoginOtpHandler(
  request: FastifyRequest<{ Body: VerifyLoginOtpInput }>,
  reply: FastifyReply
) {
  try {
    const sign = (payload: object) => request.jwt.sign(payload);
    const result = await AuthService.verifyLoginOtp(request.body.email, request.body.code, sign);
    return reply.code(200).send(result);
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Exchanges a refresh token for a new token pair; intentionally has no auth preHandler, since an expired access token is exactly the state a client calls this to recover from. */
export async function refreshHandler(
  request: FastifyRequest<{ Body: RefreshTokenInput }>,
  reply: FastifyReply
) {
  try {
    const sign = (payload: object) => request.jwt.sign(payload);
    const result = await AuthService.refresh(request.body.refreshToken, sign);
    return reply.code(200).send(result);
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Revokes the caller's own session (identified via the verified JWT's request.user.sub, not the request body) and responds 200. */
export async function logoutHandler(
  request: FastifyRequest, //Body: LogoutInput
  reply: FastifyReply
) {
  try {
    // request.user is populated by the server.authenticate preHandler
    // (JWT verification) and typed via the FastifyJWT module
    // augmentation in plugins/jwt.ts.
    const userId = request.user.sub;
    await AuthService.logout(userId);
    return reply.code(200).send({ message: "Logged out" });
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Triggers a password-reset OTP send and always responds 200 with the same generic message, regardless of whether the email actually matched an account. */
export async function forgotPasswordHandler(
  request: FastifyRequest<{ Body: ForgotPasswordInput }>,
  reply: FastifyReply
) {
  try {
    await AuthService.forgotPassword(request.body.email);
    return reply.code(200).send({ message: "If the account exists, a password reset code has been sent." });
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}

/** Confirms the password-reset code, sets the new password, and responds 200 — the caller must log in again afterward since resetPassword revokes any existing session. */
export async function resetPasswordHandler(
  request: FastifyRequest<{ Body: ResetPasswordInput }>,
  reply: FastifyReply
) {
  try {
    await AuthService.resetPassword(request.body);
    return reply.code(200).send({ message: "Password reset. Please log in with your new password." });
  } catch (e) {
    return handleAuthError(e, request, reply);
  }
}