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

## Fee accounting status

Nomba charges a flat ₦20 on inbound transfers and ₦50 on outbound transfers. These are passed through to users via a 5-account ledger split (see `docs/project_nomba_fee_accounting` context and `apps/backend/src/lib/fees.ts`).

- Contribution intake, manual payout (with amount), target_based payout, scheduled/recurring payout, and contributors-refund fan-out all correctly post fee legs and are shown to users in the relevant modals (`ContributeModal`, `PayoutAmountModal`, `PayoutDestinationModal`, `TargetBasedConfigStep`).
- **Known gap:** the overpayment-refund path (`contributions.service.ts` → `nomba.refundOverpayment`) sends a direct bank transfer with no ledger entry at all — the ₦20/₦50 Nomba fee for that transfer is untracked. This breaks the double-entry invariant in `docs/system-rules.md` and needs a ledger leg before it's safe to rely on in production.
- **Known gap:** the refund confirmation modal (`RefundConfirmModal.tsx`) shows no amount or fee breakdown before an admin/contributor confirms a refund, unlike every other money-moving confirmation in the app.

## Known blockers before real-world use

1. Overpayment refunds move real money with no ledger trail (see above) — highest priority fix.
2. Refund confirmation UI doesn't show the amount/fee being sent before an irreversible transfer.
3. `.env.example` still defaults to `NOMBA_ENVIRONMENT=sandbox` with placeholder client ID/webhook secret and no enforced go-live checklist to switch to live Nomba credentials.
4. `NOMBA_TRANSFER_RATE_LIMIT_MAX` in `.env.example` is an explicit placeholder, not Nomba's real documented rate limit.
5. Outbound email now goes through Brevo's transactional API (not Gmail SMTP as previously assumed) — confirm the sending domain is verified before launch.

No blocking TODOs were found in the core payment/payout/refund code paths beyond the items above.
