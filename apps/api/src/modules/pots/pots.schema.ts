import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

// payoutMode = 'scheduled' is deliberately excluded — locked out of this
// MVU per product decision (target_based, manual, recurring, rotation
// only). Re-add once 'scheduled' ships.
const payoutModeValues = ["target_based", "manual", "recurring", "rotation"] as const;
const potTypeValues = ["public", "private"] as const;
const refundTypeValues = ["admin", "contributors"] as const;
const potMemberRoleValues = ["admin", "member"] as const;

// .min(1) rather than .positive(): zod-to-json-schema emits .positive()
// as exclusiveMinimum: true (draft-04 boolean form) when no explicit
// jsonSchema7 target is set, which AJV (Fastify's validator) rejects as
// an invalid schema at boot. .min(1) emits `minimum: 1`, which is valid
// in both forms and is equivalent for a positive integer amount anyway.
const koboAmount = z.number().int().min(1);

const destinationSchema = {
  destinationAccount: z.string().min(1),
  destinationBank: z.string().min(1),
};

// Exported (not just their inferred types) so pots.service.ts can
// re-validate a payoutConfig against one specific mode's schema via
// safeParse on the update path, where the wire schema (updatePotSchema)
// can't guarantee payoutConfig matches payoutMode itself — see that
// schema's comment.
export const targetBasedPayoutConfigSchema = z
  .object({
    ...destinationSchema,
    targetDate: z.coerce.date().optional(),
    targetAmountKobo: koboAmount.optional(),
    // No .default(false): this schema only ever compiles to JSON Schema
    // for Fastify/AJV wire validation — nothing in this codebase
    // re-parses request.body through Zod itself (see pots.service.ts) —
    // so a Zod-side .default() is never actually applied at runtime and
    // would silently mislead the inferred type. Every reader treats a
    // missing value the same as `false` explicitly instead.
    adminManualEnabled: z.boolean().optional(),
  })
  .refine(
    (c) => c.targetDate !== undefined || c.targetAmountKobo !== undefined || c.adminManualEnabled === true,
    { message: "At least one of targetDate, targetAmountKobo, or adminManualEnabled is required" }
  );

export const manualPayoutConfigSchema = z.object(destinationSchema);

export const recurringPayoutConfigSchema = z.object({
  ...destinationSchema,
  amountKobo: koboAmount,
  intervalDays: z.number().int().min(1), // see koboAmount comment above re: .positive()
  nextRunAt: z.coerce.date(),
});

const rotationLegSchema = z.object({
  ...destinationSchema,
  sequenceOrder: z.number().int().nonnegative(),
  amountKobo: koboAmount,
  scheduledDate: z.coerce.date(),
});

export const rotationPayoutConfigSchema = z.object({
  legs: z.array(rotationLegSchema).min(1),
});

// title/description/potType/refundType/min-maxContributionKobo are common
// to every payout mode — inlined into each of the 4 branches below rather
// than composed via z.intersection()/.and(). zod-to-json-schema compiles
// those to JSON Schema `allOf`, and Fastify's AJV runs with
// removeAdditional: true by default: each allOf branch's
// `additionalProperties: false` gets applied to the whole object in
// sequence, so fields declared only in a *sibling* allOf branch get
// silently stripped from request.body before the handler ever sees them
// (this was a real bug caught by booting the server and creating a pot
// live — title/potType/refundType all arrived as null). A single flat
// object per branch, unioned with discriminatedUnion, avoids allOf
// entirely and keeps one coherent property set per branch.
const potCommonFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  potType: z.enum(potTypeValues),
  refundType: z.enum(refundTypeValues),
  minContributionKobo: koboAmount.optional(),
  maxContributionKobo: koboAmount.optional(),
};

const createPotSchema = z.discriminatedUnion("payoutMode", [
  z.object({
    ...potCommonFields,
    payoutMode: z.literal("target_based"),
    payoutConfig: targetBasedPayoutConfigSchema,
  }),
  z.object({
    ...potCommonFields,
    payoutMode: z.literal("manual"),
    payoutConfig: manualPayoutConfigSchema,
  }),
  z.object({
    ...potCommonFields,
    payoutMode: z.literal("recurring"),
    payoutConfig: recurringPayoutConfigSchema,
  }),
  z.object({
    ...potCommonFields,
    payoutMode: z.literal("rotation"),
    payoutConfig: rotationPayoutConfigSchema,
  }),
]);

const potResponseSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  potType: z.enum(potTypeValues),
  status: z.enum(["draft", "open", "closed"]),
  payoutMode: z.enum(payoutModeValues),
  refundType: z.enum(refundTypeValues),
  shareSlug: z.string(),
  minContributionKobo: z.string(),
  maxContributionKobo: z.string().nullable(),
  activatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const potListResponseSchema = z.array(potResponseSchema);

// NOT a discriminated union, unlike createPotSchema — this is a deliberate
// departure, not an oversight. AJV's removeAdditional: true (Fastify's
// default) doesn't reject a payload with extra properties against an
// anyOf/oneOf branch that doesn't declare them; it silently STRIPS the
// extras and lets that branch match anyway. With a "no payout change"
// branch present (needed since a draft edit may touch only title, only
// payout config, or both), that permissive branch is a strict subset of
// every mode branch's properties, so AJV always matched request.body
// against it first — payoutMode/payoutConfig were silently deleted from
// every update request before the handler ever saw them (a real bug,
// caught by booting the server and PATCHing a live draft pot: the
// response kept the OLD payoutMode despite a valid new one being sent).
// A single flat, permissive object sidesteps the ambiguity entirely —
// there is no second branch for AJV to wrongly prefer. payoutConfig's
// shape is validated against payoutMode in PotsService.update instead,
// which is the authoritative check anyway (nothing here can validate
// "payoutConfig matches payoutMode" cheaply without the union).
const updatePotSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  minContributionKobo: koboAmount.optional(),
  maxContributionKobo: koboAmount.optional(),
  payoutMode: z.enum(payoutModeValues).optional(),
  payoutConfig: z
    .union([
      targetBasedPayoutConfigSchema,
      manualPayoutConfigSchema,
      recurringPayoutConfigSchema,
      rotationPayoutConfigSchema,
    ])
    .optional(),
});

const potIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// role has no .default("member") — same reasoning as adminManualEnabled
// above: Zod defaults never apply at runtime in this request pipeline.
// pot-members.service.ts must treat a missing role as 'member' itself.
const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(potMemberRoleValues).optional(),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(potMemberRoleValues),
});

const memberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

const memberResponseSchema = z.object({
  id: z.string().uuid(),
  potId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(potMemberRoleValues),
  invitedByUserId: z.string().uuid().nullable(),
  joinedAt: z.string(),
});

const memberListResponseSchema = z.array(memberResponseSchema);

const messageResponseSchema = z.object({
  message: z.string(),
});

// Same {accountNumber, bankCode} shape as destinationSchema — only
// meaningful for a refundType='contributors' pot (see contributions.ts
// schema comment). ContributionsService.create enforces it's
// required/rejected based on the target pot's actual refundType, since
// that can't be expressed in this wire schema alone (would need the pot
// loaded first).
const contributeSchema = z.object({
  amountKobo: koboAmount,
  anonymous: z.boolean().optional(),
  refundAccountNumber: z.string().min(1).optional(),
  refundBankCode: z.string().min(1).optional(),
  idempotencyKey: z.string().optional(),
});

const transactionResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["funding", "contribution", "payout", "refund", "fee", "transfer", "reversal"]),
  status: z.enum(["pending", "processing", "completed", "failed", "reversed"]),
  reference: z.string(),
  externalReference: z.string().nullable(),
  amountKobo: z.string(),
  createdAt: z.string(),
});

// Returned by POST /pots/:id/contributions — a pending funding intent, not
// yet a ledger transaction (see contributions.service.ts: the ledger is
// only touched once Nomba's funding webhook confirms real money moved).
const contributionResponseSchema = z.object({
  id: z.string().uuid(),
  potId: z.string().uuid(),
  contributorUserId: z.string().uuid(),
  virtualAccountRef: z.string(),
  virtualAccountNumber: z.string().nullable(),
  expectedAmountKobo: z.string(),
  status: z.enum(["pending", "funded", "underpaid", "failed", "reversed"]),
  anonymous: z.boolean(),
  refundAccountNumber: z.string().nullable(),
  refundAccountName: z.string().nullable(),
  refundBank: z.string().nullable(),
  transactionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  fundedAt: z.string().nullable(),
});

export type CreatePotInput = z.infer<typeof createPotSchema>;
export type UpdatePotInput = z.infer<typeof updatePotSchema>;
export type PotIdParams = z.infer<typeof potIdParamsSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type MemberParams = z.infer<typeof memberParamsSchema>;
export type ContributeInput = z.infer<typeof contributeSchema>;

export const { schemas: potSchemas, $ref } = buildJsonSchemas(
  {
    createPotSchema,
    updatePotSchema,
    potResponseSchema,
    potListResponseSchema,
    potIdParamsSchema,
    addMemberSchema,
    updateMemberRoleSchema,
    memberParamsSchema,
    memberResponseSchema,
    memberListResponseSchema,
    messageResponseSchema,
    contributeSchema,
    transactionResponseSchema,
    contributionResponseSchema,
  },
  { $id: "pots" }
);
