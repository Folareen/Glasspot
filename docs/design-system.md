# Design system

Locked, implementation-ready spec. Build against this directly. For the reasoning/research behind
these choices, see [design-inspiration.md](design-inspiration.md).

## Theme

Single neutral theme, no light/dark toggle for MVP.

| Token | Value | Use |
|---|---|---|
| `background` | `#E3E6E9` | App base surface |
| `surface` | `#EDEFF1` | Cards, raised elements (one step lighter than background) |
| `text-primary` | `#15171B` | Primary text (near-black cool neutral, never pure `#000`) |
| `text-secondary` | `#5C6169` | Secondary/muted text |
| `border` | `#CDD2D6` | Hairlines, dividers, default card separation |

## Color

| Token | Value | Use |
|---|---|---|
| `accent` | `#0F6E5F` (deep teal) | Primary buttons, active/selected states, links, key interactive numbers. The only color used for interactive/semantic meaning. |
| `success` | `#1E9E5A` | Money-in / success status only |
| `error` | `#C1443A` | Money-out / refund / failure status only |

**Decorative palette** (added once the base system felt too flat): `amber` (`#96682A` / soft
`#F2E7D3`), `indigo` (`#4B5A8F` / soft `#E6E9F3`), `rose` (`#9C4F42` / soft `#F3E2DE`), used
alongside `accent`'s own soft tint. These exist purely to add variety and warmth: icon badge
backgrounds, small tag/pill rotation, section background washes. They carry no meaning (unlike
`success`/`error`) and are never used for buttons, links, or form states, only `accent` does that
job. Keep them muted, matching the existing tones' saturation and depth, not neon or pastel-washed.

## Typography

- **Landing headlines:** Fraunces (variable, serif), hero/section headlines only, loaded via
  `next/font/google`.
- **Everything else** (in-app headings, body, buttons, labels, forms, nav, and landing page body
  copy): Inter. Geist is an acceptable drop-in alternative if needed.
- Weights: regular (400) / medium (500) / semibold (600) only. No light or black weights.
- All money figures use `tabular-nums`.
- **Word highlight:** a thin hand-drawn-style wavy underline (accent colored, matches the 1.5px
  illustration stroke weight) may be used under one or two words in a headline to draw the eye to
  the single most important phrase on the page. Used sparingly (a couple of times per page, not
  per section) and only in the brand accent color, never the decorative palette, so it always
  reads as "this is the point" rather than decoration.

## Shape & elevation

- Radius: `8px` inputs/chips/badges, `12px` cards/buttons, `20px` modals/sheets. No pill buttons
  except badges/tags.
- Elevation: hairline `border` for card separation by default. Shadow reserved for floating elements
  only (modals, dropdowns, toasts), one soft shadow token, never combined with a border on the same
  element.
- **Section rhythm:** on long scrolling pages (landing), alternate section backgrounds between
  `background`, `surface`, and a soft color wash (`accent-soft`, `amber-soft`, etc) so each section
  reads as its own moment while staying inside the same restrained palette. Don't put a `surface`
  background behind a section whose cards are themselves `surface` toned, the card loses its
  separation. Use a border between sections that change tone so the shift reads as deliberate.

## Illustration

Thin single-weight line shapes (1.5px stroke), low opacity, geometric (circles/arcs/dashes).
Landing page sections and empty states only, never inside core transactional screens (pot detail,
contribution flow). Landing page includes a person/avatar element (avatar stack/social-proof style),
not stock photography. Any narrative illustration (e.g. people contributing to a pot) should reflect
the actual product shape: many contributors, one or few destinations, not a literal 1:1 exchange.

## Motion

- Landing page: subtle fade/slide-in on scroll, restrained.
- In-app: fast (150 to 200ms) functional transitions only, route change, modal/sheet open-close, tab
  switch, accordion. No spring/bounce easing, no scroll-triggered animation, no decorative or
  animated illustration in-app.

## Mobile-first & PWA

- Design and build at mobile width first; adapt up to tablet/desktop.
- Installable PWA: manifest + icon set + theme-color wired through Next's metadata/manifest support.
- Respect safe-area insets (`env(safe-area-inset-*)`) on full-bleed mobile layouts (bottom nav,
  sticky headers/footers).
- Minimum 44px touch targets. No hover-only affordances.
- Side-by-side desktop layouts (e.g. hero text next to an illustration) should collapse to text-only
  on small screens rather than forcing a cramped or distracting background treatment. It's fine for
  a decorative element to only exist at `lg` and up.

## Copy

Plain language over financial/legal jargon, especially around money movement, refund conditions,
and payout rules, e.g. "You'll get this money back if the goal isn't met by July 2" over "Refund
eligibility is contingent upon...". No emoji as UI elements in the product itself. No em dashes,
write like a person explaining something, not like generated copy (periods, commas, and colons
instead of dash-chained clauses).
