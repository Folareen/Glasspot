/**
 * Builds a Fastify app instance for tests. Sets TESTING=true before
 * importing buildApp so app.ts's `logger: process.env.TESTING !== "true"`
 * check silences logging.
 *
 * Does NOT mock the BullMQ plugin or Redis connection — per your setup,
 * tests run against a real Redis. Make sure REDIS_URL (or whatever
 * lib/plugins/bullmq.ts reads) points at a test/local Redis instance
 * before running.
 *
 * Always call `await app.close()` in a test's teardown — this also tears
 * down the BullMQ plugin's connections per fastify-plugin's encapsulation,
 * so leaving it out will leak open handles and hang the test process.
 */
process.env.TESTING = "true";

import { buildApp } from "../../src/app";

export function createTestApp() {
  return buildApp();
}