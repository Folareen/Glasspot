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
- Concise summary of work done in past tense

**Types**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

## Pull requests

- Title: same format as a commit message 
- One branch/task per PR. Squash-merge into `master` so the PR title becomes the commit on `master`.
- Description covers: what changed, why, and how it was tested.
