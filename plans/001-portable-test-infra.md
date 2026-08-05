# Plan 001: Make the test suite runnable on any machine (env-driven DB, documented setup, root scripts)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/tests/dev/index.ts package.json CONTRIBUTING.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / dx
- **Planned at**: commit `90411f2`, 2026-07-29

## Why this matters

Every one of the 21 test files boots a Payload instance whose Postgres connection string is hardcoded to one developer's personal local database (`postgres://forrestdevs:@localhost:5432/auth-test` — a personal role name with empty password; not a secret, but machine-specific). No other contributor and no CI runner can execute `pnpm test` at all. This is the single blocker in front of every other quality improvement in this repo: CI gates (plan 002), regression tests for security fixes (plan 003), and join-correctness tests (plan 004) all require a reproducible test run first.

## Current state

- `packages/payload-auth/src/better-auth/tests/dev/index.ts` — the Payload config every test loads (via `tests/helpers/setup.ts:3` → `import { getPayload } from "../dev"`). Lines 246–261:

```ts
export const payloadConfig = buildConfig({
  admin: {
    user: "users"
  },
  serverURL: "http://localhost:3000",
  secret: "super-secret-payload-key",
  db: postgresAdapter({
    pool: {
      connectionString: "postgres://forrestdevs:@localhost:5432/auth-test"
    },
    migrationDir: decodeURIComponent(
      new URL("./migrations", import.meta.url).pathname
    ),
    transactionOptions: false,
    push: false
  }),
```

- `push: false` + a committed `packages/payload-auth/src/better-auth/tests/dev/migrations/` directory means a fresh database also needs a migration run. The package script `test:payload` already exists for this: `"test:payload": "cross-env PAYLOAD_CONFIG_PATH=src/better-auth/tests/dev/index.ts payload"` (`packages/payload-auth/package.json:75`), so `pnpm test:payload migrate` applies migrations.
- An untracked, gitignored `.env` file exists at `packages/payload-auth/src/better-auth/tests/dev/.env` defining a `DATABASE_URL` key that **nothing reads**. There is no `.env.example` under `packages/payload-auth/`.
- `dotenv` is already a devDependency of the package (`packages/payload-auth/package.json`), so reading a `.env` file requires no new install.
- Root `package.json` scripts are only `clean-all`, `build`, `publish`, `dev`, `format` — there is no way to run tests from the repo root. Test scripts live only in `packages/payload-auth/package.json`: `"test": "vitest"`, `"test:run": "vitest run"`.
- `dev-docs/TEST-PLAN.md:38` instructs `docker compose up -d postgres`, but no compose file exists anywhere in the repo.
- Root `CONTRIBUTING.md` is a two-line stub.
- Repo conventions: double quotes, semicolons, 2-space indent (see any file under `packages/payload-auth/src`). Commit messages are conventional commits (enforced by CI commitlint), e.g. `fix: joins need to transformOutput on nested docs`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` (repo root) | exit 0 |
| Start test DB | `docker compose -f docker-compose.test.yml up -d` (repo root, after step 3) | container healthy |
| Migrate test DB | `cd packages/payload-auth && pnpm test:payload migrate` | exit 0, migrations applied |
| Run tests | `cd packages/payload-auth && pnpm test:run` | vitest run completes |
| Build | `cd packages/payload-auth && pnpm build` | exit 0, `dist/` produced |

Note: all shell commands must quote the repo path — it contains spaces (`.../com~apple~CloudDocs/dev/payload-better-auth`).

## Scope

**In scope** (the only files you should modify/create):
- `packages/payload-auth/src/better-auth/tests/dev/index.ts` (modify — connection string only)
- `packages/payload-auth/.env.example` (create)
- `docker-compose.test.yml` at repo root (create)
- Root `package.json` (add `test` / `test:run` scripts only)
- `CONTRIBUTING.md` (add test-setup section)

**Out of scope** (do NOT touch, even though they look related):
- `vitest.config.ts` / `vite.config.ts` — config consolidation is a separate finding; leave both files alone.
- Splitting unit tests from DB-bound tests — explicitly deferred (see Maintenance notes).
- `tests/dev/index.ts` beyond the `connectionString` line — the hardcoded `secret` and `serverURL` are test-only values and fine as defaults.
- `.github/workflows/**` — CI is plan 002.
- `dev-docs/TEST-PLAN.md` — doc reconciliation is a separate finding.

## Git workflow

- Branch: `advisor/001-portable-test-infra`
- Conventional commit messages, e.g. `chore: make test database configurable via DATABASE_URL`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Read the DB connection from the environment

In `packages/payload-auth/src/better-auth/tests/dev/index.ts`, replace the hardcoded connection string:

```ts
connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/auth-test"
```

At the top of the file, load the sibling `.env` so the existing (gitignored) file finally works. `dotenv` is already a devDependency:

```ts
import dotenv from "dotenv";
dotenv.config({ path: new URL("./.env", import.meta.url).pathname });
```

Place the `dotenv.config` call before `buildConfig` is evaluated (top of file, after imports).

**Verify**: `grep -n "forrestdevs" packages/payload-auth/src/better-auth/tests/dev/index.ts` → no matches.

### Step 2: Create `packages/payload-auth/.env.example`

```
# Postgres database used by the vitest suite (see docker-compose.test.yml at repo root)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/auth-test
```

Do not add real credentials of any kind.

**Verify**: `cat packages/payload-auth/.env.example` → shows exactly the placeholder DSN above.

### Step 3: Create `docker-compose.test.yml` at the repo root

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: auth-test
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d auth-test"]
      interval: 2s
      timeout: 3s
      retries: 15
```

**Verify**: `docker compose -f docker-compose.test.yml config` → exit 0 (valid file). If Docker is unavailable in your environment, note that in your report and continue — the file's validity can be checked by YAML parse.

### Step 4: Add root test scripts

In the root `package.json` `scripts` block, add:

```json
"test": "pnpm --filter payload-auth test",
"test:run": "pnpm --filter payload-auth test:run"
```

(`payload-auth` is the package name in `packages/payload-auth/package.json:2`.)

**Verify**: `pnpm run --silent test:run --help 2>&1 | head -1` runs vitest's help via the filter (or simply confirm `node -e "const p=require('./package.json'); if(!p.scripts['test:run']) process.exit(1)"` → exit 0).

### Step 5: Document the setup in `CONTRIBUTING.md`

Append a "Running the tests" section covering exactly: (1) `docker compose -f docker-compose.test.yml up -d`, (2) `cd packages/payload-auth && pnpm test:payload migrate` on first run, (3) `pnpm test:run` (or root `pnpm test:run`), (4) `DATABASE_URL` override via `packages/payload-auth/src/better-auth/tests/dev/.env` or environment. Also state that conventional-commit messages are required (CI enforces commitlint).

**Verify**: `grep -n "docker compose" CONTRIBUTING.md` → at least one match.

### Step 6: Prove the suite runs end-to-end

With Docker available: start the DB (step 3 command), run migrations, then `cd packages/payload-auth && pnpm test:run`. Record the pass/fail counts in your report. The suite is expected to complete; if pre-existing test failures occur, record them verbatim — they are baseline information, not something to fix in this plan.

**Verify**: `pnpm test:run` completes (exit code may be non-zero if pre-existing failures exist — record, don't fix).

## Test plan

No new test files. The deliverable *is* test executability: the verification is step 6's full-suite run against a containerized Postgres that did not exist before this plan.

## Done criteria

- [ ] `grep -rn "forrestdevs" packages/payload-auth/src` → no matches
- [ ] `packages/payload-auth/.env.example` exists and contains `DATABASE_URL=`
- [ ] `docker-compose.test.yml` exists at repo root and `docker compose -f docker-compose.test.yml config` exits 0
- [ ] Root `package.json` has `test` and `test:run` scripts
- [ ] `CONTRIBUTING.md` documents DB setup + migrate + test commands
- [ ] Full suite executed once via the new path (results recorded in report)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `tests/dev/index.ts` no longer contains the hardcoded `connectionString` (someone fixed it already).
- `pnpm test:payload migrate` fails against a fresh containerized Postgres (the committed migrations may assume a state the migration files don't produce — that is a finding to report, not to patch here).
- More than 10 test files fail in step 6 (suggests an environment mismatch worth human review rather than a baseline quirk).

## Maintenance notes

- Plan 002 (CI gate) consumes this work: the workflow uses the same `DATABASE_URL` env var and a Postgres service container mirroring `docker-compose.test.yml`.
- Deferred follow-up: split pure-unit specs (`tests/adapter/transform.test.ts`, `tests/plugin/payload-access.test.ts`, `tests/plugin/organizations-plugin.test.ts`, mocked hook tests) into a vitest project that does not import `tests/dev`, so they run with zero infrastructure. Deferred because it touches many imports and is not needed to unblock CI.
- Reviewer: check that `dotenv.config` doesn't leak into the published build — `tests/**` is excluded from the build by `.swcrc` `exclude` and `tsconfig.json` `exclude`, so it cannot, but confirm no import from `tests/` was added elsewhere.
