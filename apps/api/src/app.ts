import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "@/routes/health";
import jwtPlugin from "@/lib/plugins/jwt";
import bullmqPlugin from "@/lib/plugins/bullmq";
import env from "@/config/env";
import authRoutes from "@/modules/auth/auth.route";
import { authSchemas } from "@/modules/auth/auth.schema";
import potsRoutes from "@/modules/pots/pots.route";
import { potSchemas } from "@/modules/pots/pots.schema";
import nombaWebhooksRoutes from "@/integrations/nomba/nomba-webhooks.route";

/** Builds and configures the Fastify app: registers shared schemas, the JWT/rate-limit/CORS/BullMQ plugins, and all route modules. */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  for (const schema of authSchemas) {
    app.addSchema(schema);
  }
  for (const schema of potSchemas) {
    app.addSchema(schema);
  }

  app.register(jwtPlugin);
  app.register(rateLimit, { global: false });
  app.register(cors, { origin: env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.register(bullmqPlugin);
  app.register(
    async (api) => {
      api.register(healthRoutes);
      api.register(authRoutes, { prefix: "/auth" });
      api.register(potsRoutes, { prefix: "/pots" });
      api.register(nombaWebhooksRoutes, { prefix: "/webhooks" });
    },
    { prefix: "/api/v1" }
  );

  return app;
}