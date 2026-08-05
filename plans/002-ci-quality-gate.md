# Plan 002: Add a CI quality gate (build + tests on every PR) and make the release install reproducible

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- .github/workflows/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-portable-test-infra.md
- **Category**: dx / security
- **Planned at**: commit `90411f2`, 2026-07-29

## Why this matters

The only CI workflows today are commitlint and the two npm publish workflows. Nothing builds the package or runs a single test before `semantic-release` publishes to the `latest` tag — a broken commit merged to `main` ships to npm automatically. Additionally, the production release workflow installs with `--no-frozen-lockfile`, so the published artifact is built against a dependency tree that may not match the committed lockfile (the canary workflow already uses `--frozen-lockfile`; the production one is the permissive outlier). This plan adds a PR/push CI workflow (build + full test suite against a Postgres service) and aligns the release install with the lockfile.

## Current state

- `.github/workflows/` contains exactly: `lint-commit-messages.yml`, `release.yml`, `release-canary.yml`. None runs tests or a standalone build check.
- `.github/workflows/release.yml:61` — `run: pnpm install --no-frozen-lockfile` (the job later runs `pnpm run build` at line ~65 and then semantic-release).
- `.github/workflows/release-canary.yml:61` — `run: pnpm install --frozen-lockfile` (the pattern to copy; that workflow also does `pnpm/action-setup@v4`, `actions/setup-node@v4` with `node-version: 22` and `cache: 'pnpm'`).
- Tests: after plan 001, `packages/payload-auth` tests read `process.env.DATABASE_URL` (fallback `postgres://postgres:postgres@localhost:5432/auth-test`), require a migration run first (`pnpm test:payload migrate`), and run via `pnpm test:run` (vitest, `fileParallelism: false`, 30s test timeout / 60s hook timeout).
- Build command for the package: `pnpm build` inside `packages/payload-auth` (clean → copyfiles → generate types + tsc declarations → swc). Root `pnpm build` runs it through turbo (`turbo run build --filter=./packages/payload-auth`).
- **Known caveat**: at plan time the working tree had ~2,000 lines of uncommitted `pnpm-lock.yaml` drift. A `--frozen-lockfile` install only works when the committed lockfile matches the manifests.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Frozen install (local check) | `pnpm install --frozen-lockfile` (repo root) | exit 0 |
| Build | `pnpm build` (repo root) | exit 0 |
| Workflow syntax check | `actionlint` if available, else careful YAML review | no errors |
| Tests (local, with DB up) | `cd packages/payload-auth && pnpm test:payload migrate && pnpm test:run` | suite completes |

## Scope

**In scope** (the only files you should modify/create):
- `.github/workflows/ci.yml` (create)
- `.github/workflows/release.yml` (modify — one line: the install flag)

**Out of scope** (do NOT touch):
- `pnpm-lock.yaml` — if it is dirty or out of sync, STOP and report; regenerating the lockfile is an operator decision.
- `release-canary.yml`, `lint-commit-messages.yml` — already fine.
- Adding lint/typecheck scripts — a formatter/linter decision (Biome vs Prettier) is unresolved; a lint job would codify a choice this plan is not chartered to make.
- `turbo.json` — task-graph work is deferred.

## Git workflow

- Branch: `advisor/002-ci-quality-gate`
- Conventional commits, e.g. `ci: add build+test workflow with postgres service`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, canary]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: auth-test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres -d auth-test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/auth-test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Build package
        run: pnpm build
      - name: Run migrations
        working-directory: packages/payload-auth
        run: pnpm test:payload migrate
      - name: Run tests
        working-directory: packages/payload-auth
        run: pnpm test:run
```

Match the setup-step style of `release-canary.yml` (same action versions) so the workflows stay consistent.

**Verify**: `actionlint .github/workflows/ci.yml` → no errors (if `actionlint` is unavailable, validate YAML parses: `node -e "require('js-yaml')"` alternatives are fine; state which check you used).

### Step 2: Fix the release install flag

In `.github/workflows/release.yml`, change:

```yaml
run: pnpm install --no-frozen-lockfile
```

to:

```yaml
run: pnpm install --frozen-lockfile
```

**Verify**: `grep -c "no-frozen-lockfile" .github/workflows/release.yml` → `0`; `grep -c "frozen-lockfile" .github/workflows/release.yml` → `1`.

### Step 3: Confirm a frozen install works against the committed lockfile

Run `pnpm install --frozen-lockfile` at the repo root.

**Verify**: exit 0. If it fails with a lockfile mismatch, STOP (see below).

## Test plan

No new test files. The workflow itself is the artifact; if the operator permits pushing a branch, the real verification is a green run of `ci.yml` on GitHub. Otherwise steps 1–3's local checks stand in.

## Done criteria

- [ ] `.github/workflows/ci.yml` exists with a Postgres service, frozen install, build, migrate, and test steps
- [ ] `release.yml` uses `--frozen-lockfile`
- [ ] `pnpm install --frozen-lockfile` exits 0 locally
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 is not yet DONE (tests still hardcode the personal DSN) — this workflow cannot pass without it.
- `pnpm install --frozen-lockfile` fails at the root: the committed lockfile doesn't match the manifests. Report the mismatch; do not regenerate the lockfile yourself.
- `release.yml` has materially changed shape since `90411f2` (e.g. install step moved/renamed).

## Maintenance notes

- When a formatter/linter decision lands (Biome vs Prettier — currently both configured with opposing styles), add a `lint` job here.
- When unit tests are split from DB-bound tests (deferred from plan 001), add a fast no-service job that runs them on every push, keeping the Postgres job for PRs.
- The demo app is not built in CI; if the demo is meant as an integration check, add a `pnpm --filter demo build` job later (note: demo currently pins `@payloadcms/*` 3.67.0, 12 minors behind the package — that skew is a separate recorded finding).
