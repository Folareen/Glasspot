# Glasspot

Pooled-money product: groups agree on a payout rule before contributing, so money only moves when the rule is met or a trusted member acts in the open.

## Docs — read the relevant one before acting

Product (applies to both apps/web and apps/backend):
- [docs/spec.md](docs/spec.md) — full product spec, all features including not-yet-built ones (recurring pots, card payments, community features). Use for understanding long-term product direction.
- [docs/spec-mvp.md](docs/spec-mvp.md) — MVP-only subset of the spec. Use this as the source of truth for what to actually build right now; don't implement spec.md features that aren't in spec-mvp.md without confirming first.

Backend (apps/backend):
- [docs/system-rules.md](docs/system-rules.md) — money/ledger engineering invariants (double-entry, integer kobo, immutability, idempotency, reconciliation, locking). Read this before touching anything involving contributions, payouts, refunds, or the ledger.
- [docs/backend-rules.md](docs/backend-rules.md) — backend coding style (Fastify, Drizzle, OOP/SOLID, naming, when to ask vs assume). Read this before writing or reviewing any backend code.

Frontend (apps/web):
- [docs/design-system.md](docs/design-system.md) — locked, implementation-ready visual design system (colors, type, radius, motion, PWA). Read this before building any UI.
- [docs/design-inspiration.md](docs/design-inspiration.md) — research/rationale behind the design system (Nigerian fintech UI patterns, do/don't). Reference for *why*, not for implementation.
- [docs/frontend-rules.md](docs/frontend-rules.md) — frontend coding style (Next.js App Router, shared component library, Tailwind conventions, dependency discipline). Read this before writing or reviewing any frontend code.

Process:
- [docs/git-workflow.md](docs/git-workflow.md) — branch naming, commit message format, PR conventions. Follow this for every branch, commit, and PR.

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs.
