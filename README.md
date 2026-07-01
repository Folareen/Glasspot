# Glasspot — Nomba 2026 Hackathon Project

Pooled-money product: groups agree on a payout rule before contributing, so money only moves when the rule is met or a trusted member acts in the open. See [CLAUDE.md](CLAUDE.md) for the docs index.

## Monorepo layout

- `apps/web` — Next.js (App Router, TypeScript, Tailwind CSS, no `src` dir)
- `apps/api` — Fastify + TypeScript
- `packages/db` — Drizzle ORM schema/client, targeting PostgreSQL

## Setup

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/health
- Postgres: `localhost:5434` (see `.env` for credentials)

## Database

```bash
pnpm db:generate   # generate a migration from packages/db/src/schema.ts
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse data with Drizzle Studio
```
