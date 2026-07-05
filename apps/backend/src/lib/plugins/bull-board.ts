import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { payoutCronQueue, transfersQueue } from "@/queues/queues";
import env from "@/config/env";

/**
 * Mounts a Bull Board dashboard at /admin/queues for inspecting both
 * queues (pending/active/failed/completed jobs, retry/remove buttons)
 * without log-diffing. Gated by BULL_BOARD_ENABLED so it never
 * accidentally ships exposed in production — this UI has no auth of its
 * own beyond whatever preHandler is added below, and it lets you inspect
 * job payloads (bank account numbers, amounts) and manually retry/delete
 * transfer jobs, so it must never be reachable by anyone but you.
 */
export default fp(async function bullBoardPlugin(app: FastifyInstance) {
  if (!env.BULL_BOARD_ENABLED) {
    return;
  }

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [new BullMQAdapter(payoutCronQueue), new BullMQAdapter(transfersQueue)],
    serverAdapter,
  });

  app.register(serverAdapter.registerPlugin(), {
    prefix: "/admin/queues",
    // ⚠ Add an admin-only preHandler here before this ever runs anywhere
    // but your local machine — see note below.
  });
});