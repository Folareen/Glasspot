# Glasspot — Product Spec

## Problem

Whenever more than one person puts money toward the same goal, that money usually lands in one person's account, and that person alone decides when it moves and where. Even when nobody does anything wrong, nobody else can see the total or stop the money if something feels off.

## Solution

Glasspot lets a group agree on the rule before anyone pays. Money only moves when that rule is met, by a fixed condition like a target or date, or by a person the group trusts acting in the open where every move is visible. Once contributions start, nobody can quietly change the rule or grab the money.

## Pot

- **Type**: `private` or `public`
  - `public`: anyone can view and contribute
  - `private`: only pot members (`member` or `admin` role) can view and contribute
- **Status**: `draft`, `open`, or `closed`
  - `draft`: pot is being configured — type, members, payout rule, refund rule can all still be edited. No contributions accepted.
  - `open`: pot is activated — accepts contributions, payouts/refunds fire per configured rules. Reached from `draft` via an explicit activate action.
  - `closed`: terminal, irreversible. A pot can only close once its balance is zero.
- **Members**: creator, admin(s), member(s). Admins carry the same payout/refund trigger authority as the creator wherever "admin" is referenced below.
- Payout rule and refund rule are freely editable while `draft`. Once activated (`open`), they are **immutable for the pot's remaining lifetime** — never editable again. This is what "the rule can't quietly change" means in practice.

## Contribution

- One time virtual account generated per contribution
- Optional: mark contribution as anonymous
- Optional: set a different refund destination

## Payout

Every pot picks exactly one payout mode at creation. Most modes fix their destination at creation too, except `scheduled`, which pays out to multiple destinations, and `manual`, whose destination is either fixed at creation (optional) or chosen by the triggering admin at the moment of payout if left unset.

**Locked in for this MVP (hackathon build): `target_based`, `scheduled`, `recurring`, `manual`.** These four are the ones being built and demoed now — chosen for the strongest demo story (automatic rule-based trust + Nigeria-native ajo/esusu + human-authorized-but-transparent trust), not because the others are harder.

- **`target_based`**: pays out once to one fixed destination when any of the selected conditions is met (multi-select, OR semantics) — purely rule-driven, no admin-discretion trigger
  - target date reached
  - target amount reached
- **`manual`**: pays out whenever any admin triggers it, repeatable indefinitely over the pot's lifetime. Destination is optional at creation: if set, every trigger pays out to that same fixed account (admin-discretion timing, pre-agreed destination); if left unset, the triggering admin names the destination at the moment of each payout instead — either way, the destination used is always visible on the resulting transaction afterward
- **`recurring`**: pays out a fixed amount to one destination on a fixed interval, repeating, until the pot closes
- **`scheduled`**: pays out to a sequence of destinations, each with its own amount and date, each firing once. A pot-level `ordered` flag picks the semantics: ordered fires strictly in turn — one recipient at a time, ajo/esusu-style, even if a later leg's date has also passed; unordered fires each leg independently on its own date, for staged/installment disbursements (the same destination can repeat across legs)

## Refund

- **Type**: `admin` (refunds to whoever triggers it) or `contributors` (refunds each contributor their contribution)
- Refund is the mechanism used to drain a pot's balance to zero so it can be closed, when payout isn't what drains it

## Comments

- Members can comment on a pot, separate from the payment record
- Visible to whoever can view the pot (public: anyone, private: members only)

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs
