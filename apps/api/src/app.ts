import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.register(healthRoutes);

  return app;
}
