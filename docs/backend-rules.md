Stack: Fastify + TypeScript. No NestJS.
DB: PostgreSQL via Drizzle ORM. No raw query builders, no other ORMs.
Style: OOP, SOLID. One responsibility per module. Stateless modules (services with no internal state — auth, pots, pot-members, etc.) are plain objects of functions, not classes. Use a real class only when there's actual state to encapsulate (caches, connections, in-flight request dedup — see NombaClient).
Money: integers (kobo) only. No floats. No new balance-like columns — the one materialized `balances` table (see system-rules.md) is the only sanctioned exception, and it must stay written in the same transaction as its ledger entries.
Ledger: append-only. No UPDATE or DELETE on ledger_entries, contributions, payouts, refunds.
Idempotency: every mutating method must be safe to call twice.
State: use the defined enums. No new statuses without explicit instruction.
Methods: descriptive names, one-line JSDoc explaining the "what" (purpose/behavior, not a tautology of the name). Use inline `//` comments for "why" — rationale, invariants, gotchas — only where non-obvious.
No invented abstractions. No extra tables. No extra columns. Work with the schema given.
When unsure, ask — do not assume and implement.