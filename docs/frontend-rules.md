# Frontend rules

Stack: Next.js (App Router) + TypeScript + Tailwind CSS. No UI/component library (no MUI, no
Chakra, no shadcn install-everything). No CSS-in-JS. See [design-system.md](design-system.md) for
the visual design system this all implements.

## Structure

- `app/` — routes only (pages, layouts, route handlers). No component logic living in `page.tsx`
  beyond composing shared components and page-specific data wiring.
- `components/` — shared, reusable components used across 2+ pages/routes. This is the design
  system: Button, Input, Select, Modal, Card, Spinner, Skeleton, Text, Heading, Avatar, Badge, etc.
- `components/` subfolders by domain when a set of components only makes sense together (e.g.
  `components/pot/` for pot-specific composites built from the base components).
- One component per file. Component name matches file name.
- Server Components by default. Add `"use client"` only where interactivity/state/browser APIs are
  actually needed — don't blanket-mark whole trees client.

## Component rules

- **Every page reuses the shared component set** — never hand-roll a one-off button, input, modal,
  or spinner inside a page file. If a page needs something new, build it once in `components/` and
  import it.
- Base components (Button, Input, Select, etc.) take variant/size props, not one-off style overrides
  per usage. Extend via props, not by copy-pasting the component with different classNames.
- Text and Heading are components, not raw `<p>`/`<h1>` scattered with inline classes — this is how
  the two-tier typography (Fraunces for landing headlines, Inter for everything else) and consistent
  type scale stay enforced in one place instead of copy-pasted per page.
- Compose, don't duplicate: a Modal is built once and reused for every dialog; a Skeleton is built
  once and reused for every loading state shape.
- Keep components dumb where possible — presentation + local UI state only. Data fetching and
  business logic live in the route/page or a hook, not buried inside a shared component.

## Styling

- Tailwind only. No inline `style={}` except for truly dynamic values Tailwind can't express
  (e.g. a computed progress-bar width).
- Design tokens (colors, radius, spacing, font families) go in `tailwind.config` / CSS theme
  variables, not hardcoded hex/px scattered through components. One source of truth matching
  design-inspiration.md's locked palette.
- No arbitrary one-off Tailwind values (`w-[413px]`, `text-[#1a1a1a]`) when a token already covers
  it. Add the token if it's genuinely reusable; don't invent a new magic value per component.
- Mobile-first Tailwind usage: unprefixed classes are the mobile layout, `sm:`/`md:`/`lg:` add up
  from there — never the reverse.

## Dependencies

- Don't install a package for something this small stack can do itself. Before adding anything,
  check: can Tailwind + a ~50-line component do this? Most "form/modal/dropdown library" needs are
  a Button/Modal/Select we already own.
- Avoid heavy packages pulled in for one minor feature, especially ones that are hard to restyle to
  match our design system (they fight Tailwind, ship their own CSS, or impose their own DOM/markup
  opinions).
- If a real gap exists (date picker internals, complex data table, animation primitives), prefer
  small headless/unstyled libraries (e.g. Radix primitives, Headless UI) we style ourselves over
  fully-styled component kits — never a package that dictates visual design.
- Any new dependency addition should be a deliberate call, not a default reach.
- Icons: use `lucide-react`. It is tree-shakeable, stroke-based, and matches our thin-line style
  out of the box, so there is no need to hand-roll icon SVGs.

## Next.js practices

- Use the App Router conventions as intended: `layout.tsx` for shared chrome, `loading.tsx` for
  route-level loading (backed by our shared Skeleton/Spinner), `error.tsx` for error boundaries,
  `not-found.tsx` where relevant.
- Use `next/image` for all images, `next/font` for font loading (both Fraunces and Inter loaded via
  `next/font/google`, not a CSS `@import` or external `<link>`).
- Keep route segments and folder names consistent with the URLs they represent — no unexplained
  abbreviations.
- Metadata (title, description, PWA manifest linkage) set via the Metadata API, not manual `<head>`
  tags.

## Desktop vs. mobile chrome

- Mobile stays exactly as designed: single column, bottom tab bar (`BottomNav`), full-bleed cards.
  Don't restructure mobile layout when doing desktop work.
- At `lg:` and up, the authenticated app (`(app)` route group) switches to a persistent left
  sidebar (`components/layout/Sidebar.tsx`): logo, "New pot" button, nav links, current-user
  footer. `BottomNav` hides at `lg:` (`lg:hidden`) since the sidebar replaces it as the nav surface.
  `AppShell` offsets main content with `lg:pl-64` to sit next to the sidebar.
- This is deliberately not a dense SaaS dashboard: no top-level analytics/charts, no multi-panel
  workspace, no additional top nav bar duplicating the sidebar's links. `AppHeader` (page title,
  back button, page-level action) still renders identically at every width — the sidebar owns
  cross-page navigation, `AppHeader` owns the current page's identity and actions.
- Content still uses `Container`'s `maxWidth` prop to cap reading/form width (`"2xl"` for forms and
  detail pages, the `"6xl"` default for list/browse pages) rather than letting content stretch to
  fill the space freed up by the sidebar — a capped column next to the sidebar reads as an
  intentional desktop layout, a full-bleed stretched form does not.
- Extending `Container`'s max-width: add the Tailwind class to `ContainerMaxWidth`/`maxWidthStyles`
  in `components/ui/Container.tsx` and pass `maxWidth="..."`, never pass a `max-w-*` override via
  `className` — `cn()` is a plain string-joiner (no `tailwind-merge`), so a conflicting `max-w-*` in
  `className` and in the component's own base classes both land in the class list with no
  deterministic override, which is exactly the bug this prop replaced.

## PWA

- `manifest.json` + icon set + theme-color live at the app root, wired through Next's metadata/
  manifest support.
- Respect safe-area insets (`env(safe-area-inset-*)`) in any full-bleed mobile layout (bottom nav,
  sticky headers/footers).

## Money

- The API speaks naira decimal strings end to end, "NN.NN" (e.g. "100.50"), never kobo integers —
  see docs/system-rules.md's money rule. There is no kobo anywhere in `apps/web`.
- All money parsing/formatting goes through `lib/money.ts` (`toNairaAmount`, `formatNaira`) — never
  hand-roll `Number(x) / 100`, `Math.round(x * 100)`, or a one-off `Intl.NumberFormat` call in a
  component. If you need a new money operation, add it to `lib/money.ts`, don't inline it.
- `<Money naira={...}>` (`components/ui/Money.tsx`) is the only way to display an amount — it takes
  the wire-format naira string directly and formats it, no conversion.
- A form that collects a raw amount from a user (a plain `<Input type="number">`) must run it
  through `toNairaAmount()` before it's stored in state destined for the API — this reshapes
  whatever the user typed ("100", "100.5") into the strict "NN.NN" wire format, without ever
  touching `Number()`/`Math.round()` on the combined value (split-on-decimal, per-part integer
  parsing — same approach as the backend's `nairaStringToKobo`).
- `lib/mock/store.tsx` simulates the backend's own ledger balance tracking (adding a contribution,
  subtracting a payout) since there's no real API yet (see the General section below) — that
  arithmetic goes through `lib/money.ts`'s `addNaira`/`subtractNaira`, which route through exact
  kobo-bigint math internally rather than adding naira strings as floats. Once real API integration
  replaces the mock store, this simulated arithmetic goes away entirely — the backend is the one
  source of truth for balances then.

## General

- All API integration is real — `lib/api.ts` calls the actual backend, there is no mock/demo data
  layer anymore. (The earlier demo-UI build phase used `lib/mock/store.tsx` and
  `lib/mock/fixtures.ts` for static data; both are gone, fully replaced — `lib/auth.tsx` and
  `lib/useBanks.ts` are the real `currentUser`/banks-list implementations that took their place.)
  Any new feature wires directly to a real endpoint, not a local fixture.
- No dead code, no commented-out blocks, no unused props "for later."
- When unsure whether something should be a shared component or a one-off, default to shared — it's
  cheaper to keep it in `components/` unused than to retrofit reuse later once duplication has spread.
