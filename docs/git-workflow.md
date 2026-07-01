# Git workflow

## Branches

One branch per major task, off `master`:

```
<type>/<short-description>
```

- `feat/pot-creation`
- `fix/refund-calculation`
- `chore/turborepo-setup`

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

- `feat(api): add pot creation endpoint`
- `fix(web): correct contribution amount formatting`
- `chore(db): add drizzle migration for payouts`

Scope is optional, omit it if the change spans the whole repo. Subject is lowercase, imperative, no trailing period.

**Types**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

## Pull requests

- Title: same format as a commit message — `<type>(<scope>): <subject>`
- One branch/task per PR. Squash-merge into `master` so the PR title becomes the commit on `master`.
- Description covers: what changed, why, and how it was tested.
