# Glasspot frontend

Next.js (App Router) + TypeScript + Tailwind CSS. No UI/component library — everything visual is
built once in `components/ui` and reused. See the root [README.md](../../README.md) for the
system-wide picture, [docs/frontend-rules.md](../../docs/frontend-rules.md) for coding
conventions, and [docs/design-system.md](../../docs/design-system.md) for the locked visual system
this implements.

## Route structure

Two route groups under `app/`:

- **`(marketing)`** — the public landing page (`/`). No auth required, no app chrome.
- **`(app)`** — the authenticated product surface: `/home`, `/discover`, `/activity`, `/profile`,
  pot creation/editing. Wrapped in `AppShell` (`components/layout/AppShell.tsx`), which renders
  `BottomNav` on mobile and a persistent left `Sidebar` at `lg:` and up — see
  [docs/frontend-rules.md](../../docs/frontend-rules.md)'s "Desktop vs. mobile chrome" section for
  the exact breakpoint rules.

`/pots/[id]` sits **outside** both groups, at the top level — a pot can be `public`, and an
anonymous visitor needs to open and contribute to it without a session. `/pots/new` and
`/pots/[id]/edit` (creation and admin-only editing) are the two pot-related routes that *do*
require auth, matched explicitly in `proxy.ts` rather than gating the whole `/pots` prefix.

`app/api/` holds two different kinds of routes — do not confuse them:

- `app/api/auth/*` — mint or rotate the session itself (login, register, refresh, logout, OTP,
  password reset). These need to **set** cookies on the response, so they're hand-written per
  endpoint rather than going through the catch-all.
- `app/api/[...path]/route.ts` — a catch-all BFF proxy for every other backend call. See below.

## Auth & the BFF proxy

The browser **never talks to the Fastify backend directly.** Every `apps/web/lib/api.ts` call hits
a same-origin `/api/<path>` route on the Next.js server, which:

1. Reads the access-token cookie (`glasspot_at`, httpOnly, `secure` in production, `SameSite=Lax`
   — see `lib/server/session.ts`).
2. Forwards the request to the real backend with it as an `Authorization: Bearer` header
   (`lib/server/backend-client.ts`).
3. On a `401` (expired access token), transparently calls `POST /auth/refresh` with the refresh
   token cookie, rotates both cookies, and retries the original request once — the caller never
   sees the intermediate 401.
4. Forwards an `Idempotency-Key` header through untouched when present, so contribute/payout/
   refund calls stay safe to retry from the UI.

This is a deliberate BFF (backend-for-frontend) pattern, not an accident of routing: a cookie set
directly by a cross-site backend is unreliable in Safari (ITP blocks third-party cookies even with
`SameSite=None`), and — just as important — **no token or credential is ever exposed to
client-side JS or carried in a URL/query string.** `middleware`-level route protection
(`proxy.ts`) only checks cookie *presence* to gate rendering a protected page at all; it can't
verify the JWT itself at the edge, so every real request still round-trips through the proxy above
to get an actual 401/refresh from the backend.

## Money

The API speaks naira decimal strings end to end (`"100.50"`) — there is no kobo integer anywhere
in `apps/web`. All parsing/formatting goes through `lib/money.ts` (`toNairaAmount`, `formatNaira`,
`addNaira`/`subtractNaira` for exact kobo-bigint arithmetic under the hood); `<Money naira={...}>`
(`components/ui/Money.tsx`) is the only way to display an amount. Never hand-roll `Number(x) / 100`
or a one-off `Intl.NumberFormat` call in a component — see
[docs/frontend-rules.md](../../docs/frontend-rules.md)'s Money section for the full rule and why.

## Components

- `components/ui/` — the design system itself: ~30 base components (Button, Input, Select, Modal,
  Card, Table, Money, Toast, etc.), each taking variant/size props rather than one-off style
  overrides per call site.
- `components/pot/` — pot-domain composites built from the base set (contribute modal, payout/
  refund confirmation flows, member rows, activity rows) — only exists together because these
  components only make sense in a pot's context.
- `components/layout/` — app chrome: `AppShell`, `Sidebar`, `BottomNav`, `AppHeader`, `PageHeading`.
- `components/auth/`, `components/landing/`, `components/brand/` — auth forms/OTP UI, marketing
  page sections, and brand assets (logo, wordmark), respectively.

`app/` route files compose these and handle page-specific data wiring only — no one-off buttons,
inputs, or modals hand-rolled inside a `page.tsx`.

## Setup

```bash
pnpm install
pnpm dev
```

Runs against the backend at `BACKEND_API_URL` (`lib/server/backend-client.ts`, defaults to
`http://localhost:4000`) — see `.env.example` and root [README.md](../../README.md)'s Setup
section for spinning up the full stack together.

## Learn more

This project was bootstrapped with `create-next-app`. General Next.js references:
[Next.js Documentation](https://nextjs.org/docs), [Learn Next.js](https://nextjs.org/learn).
