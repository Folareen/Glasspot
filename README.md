# Glasspot — Nomba 2026 Hackathon Project

Whenever more than one person puts money toward the same goal, that money usually lands in one person's account, and only that person decides when it moves and where. Glasspot fixes this: a group agrees on the payout rule before anyone contributes, and money only moves when that rule is met (a target amount, a date) or when a trusted member acts in the open, where every move is visible. Once contributions start, nobody can quietly change the rule or grab the money.

See [CLAUDE.md](CLAUDE.md) for the full docs index, and [docs/spec-mvp.md](docs/spec-mvp.md) for the product spec this build implements.

## Concepts

- **Pot** — a pooled-money goal. `private` (members only) or `public` (anyone can view/contribute). Starts as `draft` (fully editable), is activated to `open` (accepts contributions, payout rule now locked forever), and ends `closed` once its balance is zero.
- **Contribution** — each contribution gets its own one-time virtual account to pay into. Can be marked anonymous and can set its own refund destination.
- **Payout mode** — chosen once at pot creation, immutable after activation. MVP supports four:
  - `target_based` — pays out the full balance once, automatically, when a target amount and/or date is reached.
  - `manual` — an admin triggers payout at will, any number of times, gated by an email confirmation code. Destination is either fixed at creation or chosen per-trigger.
  - `recurring` — a fixed amount to one destination on a fixed interval, until the pot closes.
  - `scheduled` — a sequence of destinations, each with its own amount and date, either firing strictly in turn (`ordered`, ajo/esusu-style) or independently (installments).
- **Refund** — drains a pot to zero without a payout, either back to the admin or to each original contributor. Gated by the same email confirmation code as a manual payout trigger.
- **Fees** — Glasspot charges a flat ₦20 on every contribution and ₦50 on every payout/refund, always added on top so the pool amount the group agreed on is never shaved down. See the Fees section of [docs/spec-mvp.md](docs/spec-mvp.md) for exact math on full-balance payouts.

## Monorepo layout

- `apps/web` — Next.js (App Router, TypeScript, Tailwind CSS, no `src` dir)
- `apps/backend` — Fastify + TypeScript (API, worker, jobs)
- `apps/backend/src/db` — Drizzle ORM schema/client, targeting PostgreSQL

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs (virtual accounts, transfers, webhooks).

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

Fill in `apps/backend/.env` with real values before anything Nomba- or email-related will work:

- `NOMBA_CLIENT_ID`, `NOMBA_CLIENT_SECRET`, `NOMBA_ACCOUNT_ID`, `NOMBA_SUBACCOUNT_ID`, `NOMBA_WEBHOOK_SECRET` — from your Nomba dashboard (sandbox for local dev).
- `BREVO_API_KEY` and `MAIL_FROM` — used to send OTP/confirmation emails; without a real key, emails will not send.
- `JWT_SECRET` / `REFRESH_TOKEN_SECRET` — replace the sample secrets before deploying anywhere shared.

## Database

```bash
pnpm db:generate   # generate a migration from apps/backend/src/db/schema/
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse data with Drizzle Studio
```

## Money & ledger invariants

Glasspot's backend treats the ledger as the single source of truth for all balances — double-entry, integer kobo amounts, immutable rows, idempotent writes. Read [docs/system-rules.md](docs/system-rules.md) in full before touching any code that involves contributions, payouts, refunds, or account balances.

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
