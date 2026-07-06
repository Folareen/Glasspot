import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

export const bankLookupSchema = z.object({
  accountNumber: z.string().min(1),
  bankCode: z.string().min(1),
});

export const bankSchema = z.object({
  code: z.string(),
  name: z.string(),
});

export const bankListResponseSchema = z.object({
  banks: z.array(bankSchema),
});

export const bankLookupResponseSchema = z.object({
  accountNumber: z.string(),
  bankCode: z.string(),
  accountName: z.string(),
});

export type BankLookupInput = z.infer<typeof bankLookupSchema>;

export const { schemas: bankSchemas, $ref } = buildJsonSchemas(
  { bankLookupSchema, bankListResponseSchema, bankLookupResponseSchema },
  { $id: "banks" }
);
