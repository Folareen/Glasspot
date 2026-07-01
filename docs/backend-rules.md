Stack: Fastify + TypeScript. No NestJS.
DB: PostgreSQL via Drizzle ORM. No raw query builders, no other ORMs.
Style: OOP, SOLID. One responsibility per class.
Money: integers (kobo) only. No floats. No balance columns.
Ledger: append-only. No UPDATE or DELETE on ledger_entries, contributions, payouts, refunds.
Idempotency: every mutating method must be safe to call twice.
State: use the defined enums. No new statuses without explicit instruction.
Methods: descriptive names, one-line JSDoc explaining the "why" not the "what".
No invented abstractions. No extra tables. No extra columns. Work with the schema given.
When unsure, ask — do not assume and implement.