import { FastifyInstance } from "fastify";
import {
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
  registerHandler,
  resendOtpHandler,
  resetPasswordHandler,
  verifyEmailHandler,
  verifyLoginOtpHandler,
} from "./auth.controller";
import { $ref } from "./auth.schema";

/** Registers all /auth/* routes with their per-endpoint rate limits — verification endpoints allow 10 req/min, issuance endpoints (login, resend-otp) allow 5 req/min. */
async function authRoutes(server: FastifyInstance) {
  server.post(
    "/register",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("registerSchema"),
        response: { 201: $ref("registerResponseSchema") },
      },
    },
    registerHandler
  );

  server.post(
    "/verify-email",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("verifyEmailSchema"),
        response: { 200: $ref("authTokensSchema") },
      },
    },
    verifyEmailHandler
  );

  server.post(
    "/resend-otp",
    {
      config: {
        rateLimit: { max: 2, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("resendOtpSchema"),
        response: { 200: $ref("resendOtpResponseSchema") },
      },
    },
    resendOtpHandler
  );

  server.post(
    "/login",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("loginSchema"),
        response: { 200: $ref("loginResponseSchema") },
      },
    },
    loginHandler
  );

  server.post(
    "/login/verify-otp",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("verifyLoginOtpSchema"),
        response: { 200: $ref("authTokensSchema") },
      },
    },
    verifyLoginOtpHandler
  );

  server.post(
    "/refresh",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("refreshTokenSchema"),
        response: { 200: $ref("refreshTokenResponseSchema") },
      },
    },
    refreshHandler
  );

  server.post(
    "/logout",
    {
      preHandler: [server.authenticate],
      schema: {
        body: $ref("logoutSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    logoutHandler
  );

  server.post(
    "/forgot-password",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("forgotPasswordSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    forgotPasswordHandler
  );

  server.post(
    "/reset-password",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: $ref("resetPasswordSchema"),
        response: { 200: $ref("messageResponseSchema") },
      },
    },
    resetPasswordHandler
  );
}

export default authRoutes;