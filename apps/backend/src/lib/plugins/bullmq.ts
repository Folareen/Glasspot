// src/lib/plugins/bullmq.ts
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { payoutCronQueue, transfersQueue } from "@/queues/queues";
import { CronSchedulerService } from "@/modules/scheduler/cron-scheduler.service";

declare module "fastify" {
  interface FastifyInstance {
    queues: {
      payoutCron: typeof payoutCronQueue;
      transfers: typeof transfersQueue;
    };
  }
}

/** Registers cron job schedulers on boot (idempotent) and decorates the app with queue instances so routes can enqueue jobs directly. Does not create Workers — job processing happens in the separate worker.ts process. */
export default fp(async function bullmqPlugin(app: FastifyInstance) {
  app.decorate("queues", {
    payoutCron: payoutCronQueue,
    transfers: transfersQueue,
  });

  app.addHook("onReady", async () => {
    await CronSchedulerService.registerAll();
    app.log.info("BullMQ cron schedulers registered.");
  });

  app.addHook("onClose", async () => {
    await Promise.all([payoutCronQueue.close(), transfersQueue.close()]);
  });
});