# Plan 010: Stop the nextCookies() infinite form-state loop in the admin panel

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/better-auth-strategy.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1 (admin panel unusable when it triggers; multiple confirmed reports)
- **Effort**: S
- **Risk**: LOW-MED (touches the auth strategy; the change narrows behavior — read-only session lookup)
- **Depends on**: none (e2e verification benefits from plan 001)
- **Category**: bug
- **Planned at**: commit `90411f2`, 2026-07-29
- **Origin**: GitHub issue #139 (multiple reporters; root cause + fix contributed by community, verified against BA internals in their write-up)

## Why this matters

With `nextCookies()` in the Better Auth plugin list (which the plugin's own test config and docs-adjacent examples use), the Payload admin panel enters an **infinite `buildFormState` POST loop**: every admin form render calls the auth strategy → `getSession()` → BA may refresh the session and emit `Set-Cookie` → `nextCookies()` calls `cookies().set()` inside the Server Action → Next.js invalidates the router cache → re-render → repeat. Reporters see infinite POSTs, field values reverting mid-edit, and crashes. The community traced the chain and validated that a read-only session lookup in the strategy breaks the loop at its source.

## Current state

`packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/better-auth-strategy.ts` (verified at `90411f2`, lines ~17–19):

```ts
const res = await payloadAuth.betterAuth.api.getSession({
  headers
});
```

No `disableRefresh`. Better Auth's `getSession` supports `query: { disableRefresh: true }` to suppress session refresh (and thus `Set-Cookie` emission) — confirm the exact query shape in the installed BA version's types (`node_modules/better-auth/dist/**` — search for `disableRefresh`).

Context on the strategy's role: it runs on **every** authenticated Payload request (admin form state, REST, local API auth) — it only needs to *read* the session. Session refresh/rolling expiry still happens on real BA endpoints (`/api/auth/get-session` called by clients, sign-in flows) and via the plugin's own `refresh-token` endpoint, so suppressing refresh here does not stop sessions from being refreshed where it matters.

Community finding (secondary, out of our control): even with `disableRefresh`, other BA endpoints invoked during admin usage can make `nextCookies()` call `cookies().set()`; the reporter's final workaround was removing `nextCookies()` entirely. We can't patch better-auth here, but we control the strategy call and our documentation/test config.

`tests/plugin/better-auth-strategy.test.ts` mocks `getPayloadAuth` and asserts strategy logic — the pattern to extend.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Strategy tests | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/plugin/better-auth-strategy.test.ts` | pass |
| Full suite (plan-001 DB) | `pnpm test:run` | pass |
| Build | `pnpm build` | exit 0 |
| BA API check | `grep -rn "disableRefresh" packages/payload-auth/node_modules/better-auth/dist/ \| head -5` | occurrences found |

## Scope

**In scope**:
- `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/better-auth-strategy.ts`
- `packages/payload-auth/src/better-auth/tests/plugin/better-auth-strategy.test.ts` (extend)
- `dev-docs/ARCHITECTURE.md` (one paragraph documenting the read-only strategy contract and the `nextCookies` interaction)

**Out of scope**:
- Removing/stripping `nextCookies()` from user configs in `sanitizeBetterAuthOptions` — that changes user-visible behavior for non-admin flows and is a maintainer decision; record it, don't implement it.
- `refresh-token.ts` endpoint.
- Patching better-auth.

## Git workflow

- Branch: `advisor/010-disable-refresh-strategy`
- Commit: `fix: read-only session lookup in auth strategy to prevent nextCookies form-state loop`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the API shape

Grep the installed better-auth for `disableRefresh` and confirm it's accepted as `getSession({ headers, query: { disableRefresh: true } })` (boolean or string coercion — match what the types say).

**Verify**: the grep shows the option handled in `getSession`'s implementation.

### Step 2: Make the strategy read-only

```ts
const res = await payloadAuth.betterAuth.api.getSession({
  headers,
  query: { disableRefresh: true }
});
```

Add a short comment stating why (Server-Action cookie writes → router-cache invalidation → infinite `buildFormState` loop; issue #139).

**Verify**: `pnpm build` → exit 0.

### Step 3: Test it

Extend `better-auth-strategy.test.ts`: the mocked `getSession` asserts it was called with `query: { disableRefresh: true }` (and headers). Keep all existing cases green.

**Verify**: `pnpm test:run src/better-auth/tests/plugin/better-auth-strategy.test.ts` → all pass.

### Step 4: Document the contract

In `dev-docs/ARCHITECTURE.md`'s auth-strategy section, add: the strategy performs a **read-only** session lookup (`disableRefresh`) — session refresh happens only on BA endpoints and the refresh-token endpoint; plus a note that `nextCookies()` users who still see form-state loops should check issue #139 (other endpoints can also set cookies during Server Actions).

### Step 5: (If dev environment available) manual loop check

Run the demo with `nextCookies()` configured, open an admin edit view, and confirm the network tab shows no repeating `buildFormState` POSTs. If no environment, state so — the unit assertion + community verification stand in.

## Test plan

Step 3's unit assertion. Manual QA per step 5 when possible. Full suite as the fence (`pnpm test:run`) — the e2e sign-in/session suites confirm sessions still authenticate with refresh disabled in the strategy.

## Done criteria

- [ ] Strategy calls `getSession` with `disableRefresh`
- [ ] Unit test asserts the call shape; suite green
- [ ] ARCHITECTURE.md documents the read-only contract
- [ ] `pnpm build` exits 0
- [ ] No out-of-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The installed BA version doesn't support `disableRefresh` on `getSession` (then this plan must sequence after plan 008's upgrade — report, don't hack an alternative).
- Any e2e session/sign-in test fails after the change (would suggest something depends on strategy-side refresh — that dependency is the finding).

## Maintenance notes

- Maintainer decision recorded (not implemented): whether `sanitizeBetterAuthOptions` should warn when `nextCookies()` is present, since even with this fix other BA endpoints can trigger Server-Action cookie writes (per the reporter's follow-up). A `console.warn` at init pointing to the docs paragraph would be cheap.
- After landing: comment on #139 with the fix + release version; note the residual `nextCookies` caveat and the upstream better-auth issue (better-auth#8464) for the defense-in-depth cookie-comparison fix.
- If rolling session expiry regresses for admin-only users (sessions expiring despite daily admin use), the cause is this change — the remedy is refreshing via a BA endpoint call in the refresh-token flow, not re-enabling refresh in the strategy.
