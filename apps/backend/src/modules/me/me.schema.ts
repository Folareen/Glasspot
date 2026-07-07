import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

// Current user's profile, including defaultRefundAccount/defaultRefundBank —
// previously write-only via PATCH /me/refund-profile, now readable here too.
const meResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  defaultRefundAccount: z.string().nullable(),
  defaultRefundBank: z.string().nullable(),
});

// Destination for a refundType='admin' pot's refund transfer to whoever
// triggers it (see users.ts schema comment). accountNumber is looked up +
// confirmed against bankCode before being stored — see AuthService.updateRefundProfile.
const updateRefundProfileSchema = z.object({
  accountNumber: z.string().min(1),
  bankCode: z.string().min(1),
});

const refundProfileResponseSchema = z.object({
  defaultRefundAccount: z.string().nullable(),
  defaultRefundBank: z.string().nullable(),
});

// Cross-pot activity feed — same per-transaction shape as pots.schema.ts's
// transactionResponseSchema, plus potId/potTitle since entries here span
// multiple pots (unlike GET /pots/:id/transactions, where the pot is implicit).
const meTransactionResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["funding", "contribution", "payout", "refund", "fee", "transfer", "reversal"]),
  status: z.enum(["pending", "processing", "completed", "failed", "reversed"]),
  reference: z.string(),
  externalReference: z.string().nullable(),
  amount: z.string(),
  createdAt: z.string(),
  potId: z.string().uuid(),
  potTitle: z.string(),
});

const meTransactionListResponseSchema = z.array(meTransactionResponseSchema);

export type UpdateRefundProfileInput = z.infer<typeof updateRefundProfileSchema>;
export type RefundProfileResponse = z.infer<typeof refundProfileResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type MeTransactionResponse = z.infer<typeof meTransactionResponseSchema>;

export const { schemas: meSchemas, $ref } = buildJsonSchemas(
  {
    meResponseSchema,
    updateRefundProfileSchema,
    refundProfileResponseSchema,
    meTransactionListResponseSchema,
  },
  { $id: "me" }
);
