# Glasspot — Nomba 2026 Hackathon Project

Pooled-money product: groups agree on a payout rule before contributing, so money only moves when the rule is met or a trusted member acts in the open. See [CLAUDE.md](CLAUDE.md) for the docs index.

## Monorepo layout

- `apps/web` — Next.js (App Router, TypeScript, Tailwind CSS, no `src` dir)
- `apps/backend` — Fastify + TypeScript (API, worker, jobs)
- `apps/backend/src/db` — Drizzle ORM schema/client, targeting PostgreSQL

## Setup

```bash
cp apps/backend/.env.example apps/backend/.env
pnpm db:up
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/health
- Postgres: `localhost:5434` (see `apps/backend/.env` for credentials)
- Redis: `localhost:6389` (see `apps/backend/.env` for credentials)

## Database

```bash
pnpm db:generate   # generate a migration from apps/backend/src/db/schema/
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse data with Drizzle Studio
```

## Final fixes (pre-submission)

Three money-handling bugs reported during testing, investigated and fixed on the backend:

### 1. Virtual account creation was sending `expectedAmount` to Nomba, causing payment failures

`NombaClient.createVirtualAccount()` was forwarding an `expectedAmount` field on every virtual account it created (`apps/backend/src/integrations/nomba/nomba.client.ts`). In production this made Nomba fail/reject the inbound transfer whenever the contributor sent a different amount than expected — even off by a few kobo (over- or under-payment) — even though our own code already documents that Nomba's bank rails "accept any amount even when expectedAmount is set" (see `NombaClient.evaluatePayment`'s doc comment). We only need `expectedAmount` locally, to classify a payment as exact/over/under once it lands — never on the wire to Nomba. Fixed: the client still accepts `expectedAmountNaira` as an input (so we keep storing our own expectation), but it's no longer sent in the `createVirtualAccount` request body.

### 2. Target-based payout not firing at the configured amount

Investigated the full trigger path — the threshold comparison (`balance >= config.targetAmount`), the immediate post-contribution check (`TargetBasedPayoutService.checkAndFireForPot`, called right after a contribution is confirmed funded), the daily cron safety-net sweep, cron registration, and the `fired` flag (which only flips once Nomba confirms the transfer succeeded) — and found no bug in the trigger logic itself; it's correctly wired end to end. The far more likely explanation, given bug #1 above: a contribution can only push the pot's balance to its target once it actually reaches `funded` status, and a contribution stuck at `pending`/`underpaid` (because Nomba rejected or mismatched the inbound transfer — bug #1) never credits the ledger, so the pot's real balance never reaches the target even if the contributor believes they've paid enough. Fixing #1 removes the most likely cause of contributions silently failing to fund; if payouts still don't fire after this fix, the next step is to check the specific pot's contributions for `pending`/`underpaid` status rather than assuming the trigger logic itself is at fault.

### 3. Refund logic: pot balance could never reach zero after a contributors refund

This was a real bug, distinct from what it looked like. `refundType='contributors'` fans out a refund proportionally across every contributor (and, for a contributor with no refund account on file, proportionally across each of their individual funding payments — a contributor who paid in more than one transfer legitimately gets refunded to each sender). Each leg's share was computed independently via integer-kobo division truncated down, which — by design — could leave a small remainder (up to `number of legs - 1` kobo) uncollected. The problem: `pots.service.ts`'s `close()` requires the pot's ledger balance to be **exactly** zero, so that leftover dust permanently stranded the pot in an un-closeable state after any refund whose shares didn't divide evenly. This is very likely what testers experienced as "refund is behaving weirdly" — money appears to go out, but the pot balance doesn't zero out and the pot can't be closed.

Fixed via a new `distributeExactly()` helper (`apps/backend/src/modules/pots/pots.service.ts`): every leg still truncates down to the kobo except the leg with the largest share, which now absorbs whatever remainder is left over. The legs always sum to exactly the distributable pool — no kobo is ever left stranded in the pot. Added a regression test (`test/pots-trigger-refund.test.ts`) covering a 3-way split that doesn't divide evenly, asserting the total disbursed matches the distributable pool exactly.

While fixing this, also found and corrected several **stale test expectations** unrelated to the above bug: `test/pots-trigger-refund.test.ts` and `test/pots-trigger-payout.test.ts` had hardcoded amounts written before the Nomba real-fee-accounting change (flat ₦50 outbound fee netted out of every payout/refund) was merged, so several tests were asserting pre-fee amounts and failing on current `master`. Updated their expected values to match the current, correct fee-netted math (verified by hand and by the test run itself). Confirmed via a clean-`master` baseline run that these were pre-existing failures, not something introduced by this branch's changes.

**Not in scope for this pass:** three other pre-existing test failures unrelated to money logic (`test/health.test.ts`, `test/pot-members.test.ts`, `test/contributions-confirm-funcding.test.ts`) were also found failing on a clean `master` baseline. Left untouched since they're outside what was reported and touching unfamiliar test infra this close to submission carries more risk than benefit.
