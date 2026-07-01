# Glasspot — Product Spec (Full)

## Problem

Whenever more than one person puts money toward the same goal, that money usually lands in one person's account, and that person alone decides when it moves and where. Even when nobody does anything wrong, nobody else can see the total or stop the money if something feels off.

## Solution

Glasspot lets a group agree on the rule before anyone pays. Money only moves when that rule is met, by a fixed condition like a target or date, or by a person the group trusts acting in the open where every move is visible. Once contributions start, nobody can quietly change the rule or grab the money.

## Pot

- **Visibility**: private or public

## Contribution

- One time virtual account generated per contribution
- Optional: mark contribution as anonymous
- Optional: set a different refund destination
- Minimum amount, optional maximum
- Optional contribution close date
- Card payment as an additional channel, alongside bank transfer

## Payout

- **Locked** (multi select)
  - target date
  - target amount
  - manual: creator only, or any assigned member
- **Flexible**
  - manual: creator only, assigned members, or any assigned member
- Recurring pots, for dues and contributions that repeat on a schedule

## Refund

- **Type**: organizer or contributors
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
- Recurring association and cooperative dues, once recurring pots ship
- Diaspora collections, with card payment as the channel that makes this practical

## Out of scope, not by feature gap but by license or law

- Pooled investment or lending with repayment, since interest bearing products need a financial license
- Political campaign contributions, since these carry separate disclosure law obligations

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs
