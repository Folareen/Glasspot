import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "@/routes/health";
import jwtPlugin from "@/lib/plugins/jwt";
import bullmqPlugin from "@/lib/plugins/bullmq";
import bullBoardPlugin from "@/lib/plugins/bull-board";
import env from "@/config/env";
import redis from "@/config/redis";
import authRoutes from "@/modules/auth/auth.route";
import { authSchemas } from "@/modules/auth/auth.schema";
import meRoutes from "@/modules/me/me.route";
import { meSchemas } from "@/modules/me/me.schema";
import potsRoutes from "@/modules/pots/pots.route";
import { potSchemas } from "@/modules/pots/pots.schema";
import banksRoutes from "@/modules/banks/banks.route";
import { bankSchemas } from "@/modules/banks/banks.schema";
import failedJobsRoutes from "@/modules/scheduler/failed-jobs.route";
import { failedJobSchemas } from "@/modules/scheduler/failed-jobs.schema";
import nombaWebhooksRoutes from "@/integrations/nomba/nomba-webhooks.route";
import { formatSchemaErrors, sendErrorResponse } from "@/lib/http-errors";

/** Builds and configures the Fastify app: registers shared schemas, the JWT/rate-limit/CORS/BullMQ plugins, and all route modules. */
export function buildApp(): FastifyInstance {
  console.log("Building Fastify app...", { env: process.env.NODE_ENV, testing: process.env.TESTING === "true" });
  // trustProxy: true — Railway (and any platform fronting this with an edge proxy) terminates TLS
  // upstream of us, so request.ip would otherwise resolve to the proxy's own address for every
  // client, collapsing every caller into one shared rate-limit bucket (X-Forwarded-For is read
  // instead once this is set).
  // schemaErrorFormatter reshapes AJV's raw, technical validation errors (e.g. `body/email must
  // match format "email"`) into one readable sentence per field (see lib/http-errors.ts) — without
  // this, a malformed request body would show a user AJV's own JSON-pointer-flavored message
  // verbatim, since setErrorHandler below still just forwards error.message for a validation error.
  const app = Fastify({
    logger: process.env.TESTING !== "true",
    trustProxy: true,
    schemaErrorFormatter: formatSchemaErrors,
  });

  // Last-resort safety net: every route/controller in this codebase catches its own errors via
  // sendErrorResponse (see lib/http-errors.ts), but this is what stands between a route that
  // forgets to and Fastify's own default handler, which would otherwise forward a raw
  // error.message (a Postgres error, an uncaught Nomba/vendor error, a plain bug) straight to the
  // client with no redaction — same translation logic either way, so behavior doesn't change
  // based on whether a route happened to catch its own error.
  app.setErrorHandler((error, request, reply) => {
    return sendErrorResponse(error, request, reply);
  });

  for (const schema of authSchemas) {
    app.addSchema(schema);
  }
  for (const schema of meSchemas) {
    app.addSchema(schema);
  }
  for (const schema of potSchemas) {
    app.addSchema(schema);
  }
  for (const schema of bankSchemas) {
    app.addSchema(schema);
  }
  for (const schema of failedJobSchemas) {
    app.addSchema(schema);
  }

  app.register(jwtPlugin);
  // redis: without this, each per-route limit is tracked in-process only, so scaling out to
  // multiple API instances multiplies every limit by the instance count (an attacker gets N×
  // the intended budget). Shares the existing non-blocking connection (config/redis.ts) — rate
  // tracking is exactly the cache-like usage that connection is for.
  app.register(rateLimit, { global: false, redis });
  app.register(cors, { origin: env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.register(bullmqPlugin);
  app.register(bullBoardPlugin);

  app.register(
    async (api) => {
      api.register(healthRoutes);
      api.register(authRoutes, { prefix: "/auth" });
      api.register(meRoutes, { prefix: "/me" });
      api.register(potsRoutes, { prefix: "/pots" });
      api.register(banksRoutes, { prefix: "/banks" });
      api.register(failedJobsRoutes, { prefix: "/failed-jobs" });
      api.register(nombaWebhooksRoutes, { prefix: "/webhooks" });
    },
    { prefix: "/api/v1" }
  );

  return app;
}