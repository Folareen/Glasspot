import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import { AuthError, RateLimitError } from "./auth.errors";
import {
  LoginInput,
  LogoutInput,
  RefreshTokenInput,
  RegisterInput,
  ResendOtpInput,
  VerifyEmailInput,
  VerifyLoginOtpInput,
} from "./auth.schema";

function handleAuthError(e: unknown, reply: FastifyReply) {
  if (e instanceof RateLimitError) {
    return reply
      .code(429)
      .header("Retry-After", e.retryAfterSeconds)
      .send({ message: e.message });
  }
  if (e instanceof AuthError) {
    return reply.code(e.statusCode).send({ message: e.message });
  }
  console.log(e);
  return reply.code(500).send({ message: "Something went wrong" });
}

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
    return handleAuthError(e, reply);
  }
}

export async function verifyEmailHandler(
  request: FastifyRequest<{ Body: VerifyEmailInput }>,
  reply: FastifyReply
) {
  try {
    const sign = (payload: object) => request.jwt.sign(payload);
    const result = await AuthService.verifyEmail(request.body.email, request.body.code, sign);
    return reply.code(200).send(result);
  } catch (e) {
    return handleAuthError(e, reply);
  }
}

export async function resendOtpHandler(
  request: FastifyRequest<{ Body: ResendOtpInput }>,
  reply: FastifyReply
) {
  try {
    await AuthService.resendOtp(request.body.email, request.body.purpose);
    // Always the same message, regardless of whether the email exists.
    return reply.code(200).send({ message: "If the account exists, a new code has been sent." });
  } catch (e) {
    return handleAuthError(e, reply);
  }
}

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
    return handleAuthError(e, reply);
  }
}

export async function verifyLoginOtpHandler(
  request: FastifyRequest<{ Body: VerifyLoginOtpInput }>,
  reply: FastifyReply
) {
  try {
    const sign = (payload: object) => request.jwt.sign(payload);
    const result = await AuthService.verifyLoginOtp(request.body.email, request.body.code, sign);
    return reply.code(200).send(result);
  } catch (e) {
    return handleAuthError(e, reply);
  }
}

export async function refreshHandler(
  request: FastifyRequest<{ Body: RefreshTokenInput }>,
  reply: FastifyReply
) {
  try {
    const sign = (payload: object) => request.jwt.sign(payload);
    const result = await AuthService.refresh(request.body.refreshToken, sign);
    return reply.code(200).send(result);
  } catch (e) {
    return handleAuthError(e, reply);
  }
}

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
    return handleAuthError(e, reply);
  }
}