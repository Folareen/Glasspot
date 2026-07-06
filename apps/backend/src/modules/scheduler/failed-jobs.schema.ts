import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

export const failedJobIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const failedJobResponseSchema = z.object({
  id: z.string().uuid(),
  queueName: z.string(),
  jobName: z.string(),
  jobId: z.string(),
  failedReason: z.string(),
  attemptsMade: z.number(),
  status: z.enum(["pending", "retried", "ignored"]),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const failedJobListResponseSchema = z.object({
  failedJobs: z.array(failedJobResponseSchema),
});

export type FailedJobIdParams = z.infer<typeof failedJobIdParamsSchema>;

export const { schemas: failedJobSchemas, $ref } = buildJsonSchemas(
  { failedJobIdParamsSchema, failedJobResponseSchema, failedJobListResponseSchema },
  { $id: "failedJobs" }
);
