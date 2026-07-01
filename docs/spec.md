# Glasspot — Product Spec (Full)

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
- Minimum amount, optional maximum
- Optional contribution close date
- Card payment as an additional channel, alongside bank transfer

## Payout

Every pot picks exactly one payout mode at creation, to a single destination, except `rotation` and `scheduled` which pay out to multiple destinations.

- **`target_based`**: pays out to one destination when any of the selected conditions is met (multi-select, OR semantics)
  - target date reached
  - target amount reached
  - admin manual trigger
- **`manual`**: pays out to one destination whenever any admin triggers it — no condition
- **`recurring`**: pays out a fixed amount to one destination on a fixed interval, repeating, until the pot closes — for dues and contributions that repeat on a schedule
- **`rotation`**: pays out to an ordered sequence of destinations, each with its own amount and date, each firing once, one turn per recipient — for ajo/esusu-style rotating collections
- **`scheduled`**: pays out to an unordered set of one-shot entries, each with its own destination, amount, and date — e.g. pay account A ₦50,000 Monday, pay account B ₦30,000 Tuesday. Entries fire independently, no sequence dependency, and the same destination can repeat — for staged disbursements to different parties on different dates

## Refund

- **Type**: `admin` (refunds to whoever triggers it) or `contributors` (refunds each contributor their contribution)
- Refund is the mechanism used to drain a pot's balance to zero so it can be closed, when payout isn't what drains it
- Surplus refund, returning only the amount left over once payouts are settled

## Trust and visibility

- Public activity log of every payout and refund, regardless of how it was authorized
- Pledge vs confirmed contribution tracking
- Downloadable export of confirmed contributions

## Community

- Comments and announcements on a pot, separate from the payment record
- Multi channel reminders to contributors who haven't paid (SMS, email, push)

## Use cases

- Closed group collection: rent, weddings, funerals, trips, association dues, community levies
- Open fundraising: medical bills, disaster relief, school fees, public causes
- Personal convenience: a one off collection kept separate from a personal account
- Recurring association and cooperative dues, via recurring payout mode
- Rotating collections (ajo/esusu), via rotation payout mode
- Diaspora collections, with card payment as the channel that makes this practical

## Out of scope, not by feature gap but by license or law

- Pooled investment or lending with repayment, since interest bearing products need a financial license
- Political campaign contributions, since these carry separate disclosure law obligations

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs
