import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "@/routes/health";
import jwtPlugin from "@/lib/plugins/jwt";
import bullmqPlugin from "@/lib/plugins/bullmq";
import bullBoardPlugin from "@/lib/plugins/bull-board";
import env from "@/config/env";
import authRoutes from "@/modules/auth/auth.route";
import { authSchemas } from "@/modules/auth/auth.schema";
import potsRoutes from "@/modules/pots/pots.route";
import { potSchemas } from "@/modules/pots/pots.schema";
import banksRoutes from "@/modules/banks/banks.route";
import { bankSchemas } from "@/modules/banks/banks.schema";
import failedJobsRoutes from "@/modules/scheduler/failed-jobs.route";
import { failedJobSchemas } from "@/modules/scheduler/failed-jobs.schema";
import nombaWebhooksRoutes from "@/integrations/nomba/nomba-webhooks.route";

/** Builds and configures the Fastify app: registers shared schemas, the JWT/rate-limit/CORS/BullMQ plugins, and all route modules. */
export function buildApp(): FastifyInstance {
  console.log("Building Fastify app...", { env: process.env.NODE_ENV, testing: process.env.TESTING === "true" });
  const app = Fastify({ logger: process.env.TESTING !== "true" });

  for (const schema of authSchemas) {
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
  app.register(rateLimit, { global: false });
  app.register(cors, { origin: env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.register(bullmqPlugin);
  app.register(bullBoardPlugin);

  app.register(
    async (api) => {
      api.register(healthRoutes);
      api.register(authRoutes, { prefix: "/auth" });
      api.register(potsRoutes, { prefix: "/pots" });
      api.register(banksRoutes, { prefix: "/banks" });
      api.register(failedJobsRoutes, { prefix: "/failed-jobs" });
      api.register(nombaWebhooksRoutes, { prefix: "/webhooks" });
    },
    { prefix: "/api/v1" }
  );

  return app;
}