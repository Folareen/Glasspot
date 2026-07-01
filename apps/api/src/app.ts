import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import jwtPlugin from "./lib/plugins/jwt.js";
import env from "./config/env.js";
import authRoutes from "./modules/auth/auth.route.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(jwtPlugin);
  app.register(cors, { origin: env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: "/auth" });

  return app;
}
