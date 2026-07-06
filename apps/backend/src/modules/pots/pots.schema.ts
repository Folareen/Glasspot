import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

const payoutModeValues = ["target_based", "manual", "recurring", "scheduled"] as const;
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
// No admin-manual-trigger option here (deliberately removed) — a fixed
// destination with admin-discretion-only release is now manual mode's job
// (see manualPayoutConfigSchema below and manual-payout-configs.ts).
// target_based is exclusively date/amount-rule-driven; a group wanting
// "fixed destination, admin releases whenever" picks manual with a
// destination set instead.
export const targetBasedPayoutConfigSchema = z
  .object({
    ...destinationSchema,
    targetDate: z.coerce.date().optional(),
    targetAmount: koboAmount.optional(),
  })
  .refine(
    (c) => c.targetDate !== undefined || c.targetAmount !== undefined,
    { message: "At least one of targetDate or targetAmount is required" }
  );

// Manual mode's destination is optional at creation time, unlike
// target_based/recurring. If omitted, the group's agreed rule is that any
// admin can send the balance to whichever account they choose at the
// moment they trigger it (see triggerPayoutSchema below, where that
// destination is actually supplied per-trigger). If set, it acts as a
// default destination — repeatable indefinitely, unlike target_based's
// single early-release fire — see manual-payout-configs.ts. Both fields
// must be present together or both absent; .refine enforces that since
// the object shape alone can't (destinationSchema's fields are already
// each independently optional here).
export const manualPayoutConfigSchema = z
  .object({
    destinationAccount: z.string().min(1).optional(),
    destinationBank: z.string().min(1).optional(),
  })
  .refine(
    (c) => (c.destinationAccount === undefined) === (c.destinationBank === undefined),
    { message: "destinationAccount and destinationBank must both be set or both be omitted" }
  );

export const recurringPayoutConfigSchema = z.object({
  ...destinationSchema,
  amount: koboAmount,
  intervalDays: z.number().int().min(1), // see koboAmount comment above re: .positive()
  nextRunAt: z.coerce.date(),
});

const scheduledLegSchema = z.object({
  ...destinationSchema,
  sequenceOrder: z.number().int().nonnegative(),
  amount: koboAmount,
  scheduledDate: z.coerce.date(),
});

// ordered has no .default(true): this schema only ever compiles to JSON
// Schema for Fastify/AJV wire validation — nothing in this codebase
// re-parses request.body through Zod itself (see pots.service.ts) — so a
// Zod-side .default() is never actually applied at runtime and would
// silently mislead the inferred type. PotsService.insertPayoutConfig must
// treat a missing value as `true` (ajo/esusu-style strict sequencing)
// explicitly instead.
export const scheduledPayoutConfigSchema = z.object({
  ordered: z.boolean().optional(),
  legs: z.array(scheduledLegSchema).min(1),
});

// title/description/potType/refundType/min-maxContribution are common
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
  minContribution: koboAmount.optional(),
  maxContribution: koboAmount.optional(),
  // Display-only fundraising goal, independent of payoutMode — see
  // pots.ts's goalAmount comment. Never read by any trigger logic.
  goalAmount: koboAmount.optional(),
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
    payoutMode: z.literal("scheduled"),
    payoutConfig: scheduledPayoutConfigSchema,
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
  minContribution: z.string(),
  maxContribution: z.string().nullable(),
  goalAmount: z.string().nullable(),
  balance: z.string(),
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
  potType: z.enum(potTypeValues).optional(),
  refundType: z.enum(refundTypeValues).optional(),
  minContribution: koboAmount.optional(),
  maxContribution: koboAmount.optional(),
  goalAmount: koboAmount.optional(),
  payoutMode: z.enum(payoutModeValues).optional(),
  payoutConfig: z
    .union([
      targetBasedPayoutConfigSchema,
      manualPayoutConfigSchema,
      recurringPayoutConfigSchema,
      scheduledPayoutConfigSchema,
    ])
    .optional(),
});

const potIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// role has no .default("member"): this schema only ever compiles to JSON
// Schema for Fastify/AJV wire validation — nothing in this codebase
// re-parses request.body through Zod itself — so a Zod-side .default()
// is never actually applied at runtime and would silently mislead the
// inferred type. PotInvitesService.create must treat a missing role as
// 'member' itself.
//
// Members are now added by email, not userId — the admin doing the
// inviting has no way to know a stranger's userId. If the email already
// belongs to a verified user, PotInvitesService.create adds them to
// pot_members immediately; otherwise it creates a pending pot_invites row
// that AuthService.verifyEmail resolves into real membership once that
// person signs up and verifies. See pot-invites.ts schema comment.
const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(potMemberRoleValues).optional(),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(potMemberRoleValues),
});

const memberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

const inviteIdParamsSchema = z.object({
  id: z.string().uuid(),
  inviteId: z.string().uuid(),
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

// Returned by POST /pots/:id/members whenever the invited email doesn't
// belong to an already-verified user yet — see addMemberSchema's comment
// and PotInvitesService.create. status is always 'pending' here (this
// response shape is only ever returned right after creation); 'accepted'/
// 'cancelled' only show up in listInvitesResponseSchema below.
const inviteResponseSchema = z.object({
  id: z.string().uuid(),
  potId: z.string().uuid(),
  email: z.string(),
  role: z.enum(potMemberRoleValues),
  status: z.literal("pending"),
  invitedByUserId: z.string().uuid(),
  createdAt: z.string(),
});

// AJV picks the first matching branch for a oneOf-style anyOf, and
// memberResponseSchema/inviteResponseSchema don't share required fields
// with ambiguous types (userId vs email, no status on member vs a fixed
// literal status on invite), so — unlike updatePotSchema's documented
// AJV/allOf pitfall above — a plain union here is unambiguous and safe.
const addMemberResponseSchema = z.union([memberResponseSchema, inviteResponseSchema]);

const inviteListResponseSchema = z.array(
  z.object({
    id: z.string().uuid(),
    potId: z.string().uuid(),
    email: z.string(),
    role: z.enum(potMemberRoleValues),
    status: z.enum(["pending", "accepted", "cancelled"]),
    invitedByUserId: z.string().uuid(),
    acceptedUserId: z.string().uuid().nullable(),
    createdAt: z.string(),
    acceptedAt: z.string().nullable(),
  })
);

const messageResponseSchema = z.object({
  message: z.string(),
});

// Same {accountNumber, bankCode} shape as destinationSchema — only
// meaningful for a refundType='contributors' pot (see contributions.ts
// schema comment). ContributionsService.create enforces it's
// required/rejected based on the target pot's actual refundType, since
// that can't be expressed in this wire schema alone (would need the pot
// loaded first).
// Idempotency is enforced via the Idempotency-Key request header (see
// pots.controller.ts / lib/idempotency.service.ts), not a body field.
const contributeSchema = z.object({
  amount: koboAmount,
  anonymous: z.boolean().optional(),
  refundAccountNumber: z.string().min(1).optional(),
  refundBankCode: z.string().min(1).optional(),
});

// {accountNumber, bankCode}: same shape as destinationSchema — only
// meaningful (and required) for payoutMode='manual', where the group's
// agreed rule is that the destination is picked at the moment of payout,
// not fixed at pot creation. PotsService.triggerPayout enforces it's
// required/rejected based on the pot's actual payoutMode, since that
// can't be expressed in this wire schema alone (would need the pot loaded
// first — same reasoning as contributeSchema's refund fields above).
//
// amount: also manual-only. Omit for a full-balance payout (the only
// behavior before this field existed); set it for a PARTIAL payout —
// PotsService.triggerPayout rejects it as >balance and requires >0.
//
// otpCode: the 6-digit code from POST /:id/payout/otp, required to
// actually execute the payout — see ActionOtpService.verify. Bound to
// the rest of this body via hashActionContext, so a code issued for one
// destination/amount can't be replayed against a retry with different
// ones (see pots.controller.ts's triggerPayoutHandler).
const triggerPayoutSchema = z.object({
  destinationAccount: z.string().min(1).optional(),
  destinationBank: z.string().min(1).optional(),
  amount: koboAmount.optional(),
  otpCode: z.string().length(6),
});

// Body for POST /:id/payout/otp — the same destination/amount fields the
// admin intends to trigger the payout with, minus otpCode (there is none
// yet). ActionOtpService hashes this body as the code's contextHash, so
// the code that gets emailed is only valid for triggering a payout with
// these exact parameters — see triggerPayoutSchema's otpCode comment.
const requestPayoutOtpSchema = triggerPayoutSchema.omit({ otpCode: true });

// POST /:id/refund takes no other body, so its otpCode is the only
// field — no destination/amount to bind into the code's contextHash
// (ActionOtpService.hashActionContext(undefined) for the /otp request).
const triggerRefundSchema = z.object({
  otpCode: z.string().length(6),
});

const transactionResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["funding", "contribution", "payout", "refund", "fee", "transfer", "reversal"]),
  status: z.enum(["pending", "processing", "completed", "failed", "reversed"]),
  reference: z.string(),
  externalReference: z.string().nullable(),
  amount: z.string(),
  createdAt: z.string(),
});

// POST /pots/:id/refund always returns an array — one element for
// refundType='admin', one per contributor for refundType='contributors'
// (see PotsService.triggerRefund) — so the wire contract doesn't change
// shape depending on the pot's refund mode.
const refundResponseSchema = z.array(transactionResponseSchema);

// Returned by POST /pots/:id/contributions — a pending funding intent, not
// yet a ledger transaction (see contributions.service.ts: the ledger is
// only touched once Nomba's funding webhook confirms real money moved).
const contributionResponseSchema = z.object({
  id: z.string().uuid(),
  potId: z.string().uuid(),
  contributorUserId: z.string().uuid().nullable(),
  virtualAccountRef: z.string(),
  virtualAccountNumber: z.string().nullable(),
  expectedAmount: z.string(),
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
export type InviteIdParams = z.infer<typeof inviteIdParamsSchema>;
export type ContributeInput = z.infer<typeof contributeSchema>;
export type TriggerPayoutInput = z.infer<typeof triggerPayoutSchema>;
export type RequestPayoutOtpInput = z.infer<typeof requestPayoutOtpSchema>;
export type TriggerRefundInput = z.infer<typeof triggerRefundSchema>;

// Response types — the wire contract, safe for apps/web to import
// directly. Money/date fields are string here (JSON has no bigint/Date);
// see apps/backend/src/db's $inferSelect types for the corresponding domain
// shapes used internally by services (bigint/Date).
export type PotResponse = z.infer<typeof potResponseSchema>;
export type PotListResponse = z.infer<typeof potListResponseSchema>;
export type MemberResponse = z.infer<typeof memberResponseSchema>;
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
export type InviteResponse = z.infer<typeof inviteResponseSchema>;
export type AddMemberResponse = z.infer<typeof addMemberResponseSchema>;
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
export type RefundResponse = z.infer<typeof refundResponseSchema>;
export type ContributionResponse = z.infer<typeof contributionResponseSchema>;

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
    inviteResponseSchema,
    addMemberResponseSchema,
    inviteListResponseSchema,
    inviteIdParamsSchema,
    messageResponseSchema,
    contributeSchema,
    triggerPayoutSchema,
    requestPayoutOtpSchema,
    triggerRefundSchema,
    transactionResponseSchema,
    refundResponseSchema,
    contributionResponseSchema,
  },
  { $id: "pots" }
);
