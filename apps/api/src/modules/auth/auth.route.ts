import { FastifyInstance } from "fastify";
import {
  loginHandler,
  logoutHandler,
  refreshHandler,
  registerHandler,
  resendOtpHandler,
  verifyEmailHandler,
  verifyLoginOtpHandler,
} from "./auth.controller";
import { $ref } from "./auth.schema";

async function authRoutes(server: FastifyInstance) {
  server.post(
    "/register",
    {
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
        rateLimit: { max: 5, timeWindow: "1 minute" },
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
}

export default authRoutes;