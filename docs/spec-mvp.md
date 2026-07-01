# Glasspot — Product Spec

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

## Payout

- **Locked** (multi select)
  - target date
  - target amount
  - manual: creator only, or any assigned member
- **Flexible**
  - manual: creator only, assigned members, or any assigned member

## Refund

- **Type**: organizer or contributors

## Stack

Next.js, Tailwind CSS, Fastify, TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, Nomba APIs
