# Contributing to Payload Auth

Below you'll find a set of guidelines for how to contribute to Payload Auth.

## Running the tests

The test suite (`packages/payload-auth`) boots a real Payload instance backed by Postgres, so you need a database available before running it.

1. Start a local Postgres instance for the tests: `docker compose -f docker-compose.test.yml up -d`
2. On a fresh checkout, build the package first: `cd packages/payload-auth && pnpm build`. The test files import the package's own subpath exports (e.g. `payload-auth/better-auth/adapter`), which resolve through its `exports` map to `dist/`, so the suite will fail to import until you've built at least once.
3. On a fresh database, run the migrations once: `cd packages/payload-auth && pnpm test:payload migrate`
4. Run the suite from the repo root: `pnpm test:run` (or `pnpm test` for watch mode)
5. To point the suite at a different database, override `DATABASE_URL` either as an environment variable or in `packages/payload-auth/src/better-auth/tests/dev/.env` (see `packages/payload-auth/.env.example`).

Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format — CI enforces this with commitlint.
