import { buildApp } from "@/app";
import env from "@/config/env";

const app = buildApp();

app
  .listen({ port: Number(env.PORT ?? 4000), host: "0.0.0.0" })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

// Without this, a deploy/restart signal kills the process immediately — in-flight HTTP requests
// get dropped mid-response, and bullmqPlugin's own onClose hook (which closes the payoutCron/
// transfers Queue instances) never runs. app.close() drains Fastify's own connections AND cascades
// through every registered plugin's onClose hook, so this alone is enough — no separate BullMQ
// cleanup needed here (that's worker.ts's own shutdown(), a different process).
async function shutdown() {
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
