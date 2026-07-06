import { FastifyInstance } from "fastify";
import { ignoreFailedJobHandler, listFailedJobsHandler, retryFailedJobHandler } from "./failed-jobs.controller";
import { $ref } from "./failed-jobs.schema";
import type { FailedJobIdParams } from "./failed-jobs.schema";

async function failedJobsRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      preHandler: [server.authenticate],
      schema: {
        response: { 200: $ref("failedJobListResponseSchema") },
      },
    },
    listFailedJobsHandler
  );

  server.post<{ Params: FailedJobIdParams }>(
    "/:id/retry",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("failedJobIdParamsSchema"),
      },
    },
    retryFailedJobHandler
  );

  server.post<{ Params: FailedJobIdParams }>(
    "/:id/ignore",
    {
      preHandler: [server.authenticate],
      schema: {
        params: $ref("failedJobIdParamsSchema"),
      },
    },
    ignoreFailedJobHandler
  );
}

export default failedJobsRoutes;
