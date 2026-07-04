# Design inspiration

Research notes on Nigerian fintech UI (Kuda, PiggyVest, Cowrywise, Paystack, Moniepoint) — the
reasoning behind Glasspot's visual direction. For the locked, implementation-ready spec, see
[design-system.md](design-system.md).

Goal: **calm, unicorn-fintech, "money is safe here."** Not flashy, not a crypto/web3 look, not a
generic SaaS-in-a-hoodie look, not "AI startup gradient" either.

## The pattern across the best ones (Paystack, Cowrywise > Kuda > PiggyVest)

1. **Neutral base, one accent color, used sparingly.** Backgrounds are white/off-white or a single
   deep brand color for hero/marketing sections — not both fighting each other. The accent shows up
   on the 1-2 things per screen that need action (primary CTA, key balance figure), not on every
   icon, chip, and border.
2. **Numbers get the visual weight, chrome doesn't.** Balance and amounts are the largest, boldest
   text on the screen. Navigation, labels, and icons stay quiet (grey, small, low contrast) so the
   money is what the eye lands on.
3. **Cards + generous whitespace, not dense grids.** Content is grouped into simple cards with real
   padding. Nothing is crammed. Whitespace is doing trust-building work, not "empty space to fill
   later."
4. **Restrained corner radius and shadow.** Soft rounded corners (not pill-everything, not sharp
   enterprise-SaaS corners), subtle 1-step shadows or just a hairline border. No glassmorphism, no
   heavy drop shadows, no neumorphism.
5. **One typeface, 2-3 weights, does everything.** No display font + body font mixing. Hierarchy
   comes from size/weight/color, not from switching fonts.
6. **Illustration/iconography is flat, simple, and used rarely** — mostly empty states and onboarding,
   not decorating every card. When brands do use illustration (PiggyVest's piggy motifs), it's a
   single consistent character/style, not stock icon-pack mixing.
7. **Motion is functional, not decorative.** Micro-interactions confirm an action happened (a
   checkmark settling in, a number counting up, a card sliding in) — they don't exist to look cool.
   Fast, subtle, no bouncy easing everywhere.
8. **Plain-language copy over financial jargon.** "You'll get this money back if the goal isn't met
   by July 2" beats "Refund eligibility is contingent upon..." Trust is built by the copy being
   readable at a glance, not by legal precision.

## Do

- Pick **one primary accent color** (Glasspot needs its own — don't reuse Kuda purple or PiggyVest
  green/gold) and use it with intent: primary buttons, active states, key numbers.
- Use a **neutral grey/black-on-white (or near-white) base** for the app shell. Save the bold brand
  color for the marketing/landing page hero and small accents in-app.
- Make the **pot balance / contribution amount the visual hero** of any screen it appears on —
  largest text, highest contrast.
- Use **cards with consistent padding and soft radius** (think 12-16px) to group related info
  (a pot, a contribution, a member).
- Keep **navigation and secondary UI quiet** — grey text, thin icons, low visual noise.
- Use **one font family**, lean on weight (regular/medium/semibold) and size for hierarchy.
- Write **microcopy in plain English**, especially around money movement, refund conditions, and
  payout rules — this is Glasspot's actual trust surface given the pooled-money mechanic.
- Use **subtle, fast motion** for state changes (money moved, goal hit, member joined) — not for
  every hover.
- Design **empty states and zero-data states** deliberately (new pot, no contributions yet) — these
  are common in a pooled-money app and cheap "looks unfinished" tells if skipped.
- Use **subtle illustration sparingly**: thin-line shapes, abstract geometric accents (circles,
  dashes, soft blobs) around the landing page hero/sections and empty states only. One consistent
  line weight and style, low-contrast (blend into the neutral base, don't shout).
- Add a **person/avatar element on the landing page** (real-feeling human presence — avatar
  stack/social proof style) to reinforce "people you trust are already here," not stock photography.
- **Design mobile-first, verify desktop after.** Majority of usage will be mobile web/PWA — build
  and test every screen at mobile width first, then adapt up to tablet/desktop, not the reverse.
- Ship this as a **PWA** (installable, manifest + icons, works like a native app on mobile home
  screen) — this affects layout decisions (safe-area insets, touch target sizing ≥44px, no
  hover-only interactions).
- **One theme, not light+dark.** Base background sits deliberately between white and black — a
  cool neutral soft grey (not a pure light theme, not a pure dark theme). No theme toggle for MVP.
- Use **distinct type roles by context**: the landing page can use a more characterful display font
  for headlines to give the brand personality, while the in-app product uses a clean, quiet grotesk
  for everything (headings, body, buttons, labels) so the product itself stays calm and legible.
  These are two different jobs — marketing persuades, product informs — and the type should reflect
  that split without becoming two different visual languages.

## Don't

- Don't use **gradients as a crutch** — no purple-to-blue hero gradients, no gradient buttons, no
  gradient text. This is the single fastest way modern fintech UI reads as generic/AI-generated.
- Don't use **glassmorphism, neumorphism, or heavy blur panels** — reads dated/trendy, not calm.
- Don't **outline-everything or shadow-everything** — pick hairline borders OR soft shadows for
  card separation, never stack both plus a radius plus a gradient.
- Don't use **more than one accent color** doing the same job (e.g., green AND blue both meaning
  "success"/"active" on the same screen).
- Don't **overuse icons** as decoration next to every label — icons should mean something
  (navigation, category), not fill space.
- Don't use **emoji as UI elements** in the product itself (fine in marketing copy sparingly, not in
  the app chrome).
- Don't animate for spectacle — no confetti-everything, no bouncy spring on every tap, no parallax
  scroll walls on the landing page. One well-placed celebratory moment (goal reached) beats
  animating everything.
- **No animation inside the app itself** — only neat, fast transitions (page/route transitions,
  modal open/close, accordion expand, tab switch). No scroll-triggered reveals, no decorative
  motion, no animated illustrations in-app. Landing page has slightly more room for tasteful motion,
  the app product does not.
- Don't add illustration/shapes so loud they compete with numbers and CTAs — line weight thin,
  opacity low, always background-level, never foreground decoration.
- Don't design desktop-first and squeeze it down to mobile later — build mobile layouts first.
- Don't use hover-only affordances (tooltips-on-hover-only, hover-to-reveal actions) since most
  usage is touch/mobile with no hover state.
- Don't mix **multiple font families** or lean on a "startup display font" for headings and a
  different one for body.
- Don't default to **dark, moody, "fintech-noir" themes** — that reads crypto/trading app, not
  "calm shared savings with friends." Keep it a calm neutral, approachable — not a dark theme.
- Don't use a **pure white or pure black base** — both read as generic template defaults. The
  in-between neutral is a deliberate brand choice, not a placeholder.
- Don't let the **landing page's display font bleed into the app**, or vice versa — the app using a
  display/marketing font for its UI reads try-hard; the landing page using only the plain app
  grotesk for headlines reads flat and under-designed.
- Don't write **legal/bank-speak copy** ("Beneficiary disbursement is subject to...") where plain
  language works — this is the opposite of what makes Cowrywise/Paystack feel trustworthy.
- Don't ship a UI that only works at one viewport — these apps are mobile-first but Glasspot's web
  app needs to hold up on desktop too; don't just stretch a mobile layout.

## What "authentic, not vibecoded" actually means here

The tell of AI-generated/vibecoded UI is usually: purple gradient hero, glassmorphic cards, generic
"rounded everything," stock illustration packs, and copy that oversells ("Supercharge your savings
journey! 🚀"). The apps we're modeling against get trust from **restraint** — fewer colors, fewer
effects, more precise typography and spacing, and copy that sounds like a person explaining money
clearly. Every design decision from here should be checked against: *does this build clarity/trust,
or is it decoration?*

## Nomba as a trust reference, not a style reference

Nomba is Glasspot's actual payment rail (transfers, virtual accounts, settlement), not just
another app in the visual mood board. That changes how it should show up in the UI: not as
"another fintech look to borrow from," but as an **infrastructure trust signal**, the same way
a checkout flow name-drops Stripe or Plaid. A quiet "Payments powered by Nomba" mention (footer,
FAQ, or the contribution step) tells a user their money is moving on real regulated rails, not a
custom unaudited system built for this app. Keep it small, textual, and low-key, consistent with
the "restraint builds trust" principle. Don't imitate Nomba's own brand colors/marks beyond a
simple wordmark/text credit, and don't overuse the mention. It only needs to appear at the moments
where someone is deciding whether to trust the payment rail (FAQ, footer, virtual account step),
not sprinkled everywhere.

## Sources

- [Fintech UI examples to build trust — 15 real apps (Eleken)](https://www.eleken.co/blog-posts/trusted-fintech-ui-examples)
- [Fintech UX showdown: PiggyVest vs Cowrywise vs Kuda (Behance)](https://www.behance.net/gallery/222655487/Fintech-UX-showdown-PiggyVest-vs-Cowrywise-vs-Kuda)
- [PiggyVest App Design Analysis (DesignRush)](https://www.designrush.com/best-designs/apps/piggyvest-app-design)
- [Dribbble — Kuda tag](https://dribbble.com/tags/kuda)
- [Dribbble — Cowrywise tag](https://dribbble.com/tags/cowrywise)
- [Dribbble — Piggyvest tag](https://dribbble.com/tags/piggyvest)
- [Nomba](https://nomba.com) — the payment infrastructure Glasspot's contributions actually run on
