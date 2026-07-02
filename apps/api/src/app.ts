import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "@/routes/health";
import jwtPlugin from "@/lib/plugins/jwt";
import env from "@/config/env";
import authRoutes from "@/modules/auth/auth.route";
import { authSchemas } from "@/modules/auth/auth.schema";
import potsRoutes from "@/modules/pots/pots.route";
import { potSchemas } from "@/modules/pots/pots.schema";

/** Builds and configures the Fastify app: registers shared schemas, the JWT/rate-limit/CORS plugins, and all route modules. */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Routes reference these by $ref("schemaName") — must be registered
  // before any route that uses them boots, or Fastify can't resolve it.
  for (const schema of authSchemas) {
    app.addSchema(schema);
  }
  for (const schema of potSchemas) {
    app.addSchema(schema);
  }

  app.register(jwtPlugin);
  app.register(rateLimit, { global: false });
  app.register(cors, { origin: env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: "/auth" });
  app.register(potsRoutes, { prefix: "/pots" });

  return app;
}
