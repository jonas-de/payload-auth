# Plan 008: Upgrade to Better Auth 1.6.x and implement the missing adapter methods

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/package.json packages/payload-auth/src/better-auth/adapter/`
> If in-scope files changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED-HIGH (minor-version upgrade of the auth engine; wide blast radius, but the test suite + this plan's new tests fence it)
- **Depends on**: plans/001-portable-test-infra.md (the suite is the safety net for this upgrade)
- **Category**: dependencies / bug
- **Planned at**: commit `90411f2`, 2026-07-29
- **Origin**: GitHub issue #160 (`txAdapter.consumeOne is not a function`), issue #124 (org joins), `pnpm audit` (better-auth <1.6.11 OAuth refresh-token replay advisory)

## Why this matters

The repo pins `better-auth` 1.5.3; latest stable is 1.6.25 (1.7 is in RC). Consequences today:

1. **Issue #160**: Better Auth ≥1.6 calls `adapter.consumeOne()` when consuming verification values (phone OTP, and the same consume-with-lock path other verification flows use). The Payload adapter doesn't implement it, and the adapter's `transaction()` hands the adapter itself to the callback, so `txAdapter.consumeOne is not a function` hard-crashes `verifyPhoneNumber()` for every user on BA ≥1.6. The peer range (`>=1.4.0 <2` — plan 005 raises it to `>=1.5.0 <2`) tells consumers 1.6.x is supported; it isn't.
2. **Security advisory**: better-auth <1.6.11 has an OAuth refresh-token replay issue (oidc-provider/mcp plugins). Staying on 1.5.3 keeps the tested floor behind the fix.
3. The user's stated goal is "up to date and just works" — BA 1.6 is where the ecosystem (and its bugfixes) live.

A bonus of implementing `consumeOne` properly: it gives the admin-invite flow a genuinely atomic consume primitive (the March review's NEW-4 race-window note).

## Current state

- `packages/payload-auth/package.json` devDependencies: `better-auth: 1.5.3`, `@better-auth/{api-key,passkey,core,sso,stripe,scim}: 1.5.3`, `@polar-sh/better-auth: 1.8.2` (plan 005 removes the polar entries — coordinate).
- `packages/payload-auth/src/better-auth/adapter/index.ts` returns the adapter object at line ~276: `return { id: "payload-adapter", async transaction... , create, findOne, findMany, count, update, updateMany, delete, deleteMany, createSchema, ... }`. `grep -rn "consumeOne" src/better-auth/adapter/` → **zero matches** (verified).
- The `transaction<R>(callback)` method (~line 278) invokes `callback` with an object derived from the adapter (`Omit<DBAdapter, "transaction">`) — whatever methods the adapter object lacks are missing on the tx adapter too; that is where #160's crash surfaces.
- The DBAdapter contract lives in `node_modules/@better-auth/core/db/adapter/index.d.mts` — after the bump, diff its method list against the returned object to find **all** missing members, not just `consumeOne`.
- Issue #124 history: organizations reverse joins (member/invitation) crashed BA's `findFullOrganization`. Current `build-collections/organizations.ts` now has join fields `member` (line ~71), `invitation` (~85), `organizationRole` (~105) — but **no `team` join field** (removed in commit `c6c2f0c`), and BA's `findFullOrganization` destructures `team: teams` when the teams feature is enabled. Whether current BA guards a missing `team` key must be verified by test.
- Existing e2e patterns: `tests/e2e/join-resolution.test.ts`, `tests/helpers/` (`getTestContext`, `signUp`, `captureOTP` via `testUtils` plugin in `tests/dev/index.ts:142`).
- The generated types file `src/better-auth/generated-types.ts` is produced by `pnpm generate:better-auth-types` (runs automatically inside `pnpm build`) — regenerate after the bump, never hand-edit.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Bump deps | edit package.json, then `pnpm install` | exit 0 |
| Regenerate BA types + build | `cd packages/payload-auth && pnpm build` | exit 0 |
| Full suite (plan-001 DB) | `cd packages/payload-auth && pnpm test:run` | pass |
| Single spec | `pnpm test:run src/better-auth/tests/e2e/<file>` | pass |
| Interface diff | `grep -E "^\s+(abstract )?\w+\??:" node_modules/@better-auth/core/dist/db/adapter/*.d.mts` (adjust path to what exists) | method list |

## Scope

**In scope**:
- `packages/payload-auth/package.json` (devDependency versions for the better-auth family)
- `packages/payload-auth/src/better-auth/adapter/index.ts` (add missing DBAdapter methods)
- `packages/payload-auth/src/better-auth/generated-types.ts` (regenerated artifact)
- `packages/payload-auth/src/better-auth/tests/**` (new/updated tests)
- Minimal source fixes elsewhere in `src/better-auth/` **only** where the 1.6 upgrade breaks compilation or tests — each such fix must be listed in your report with the BA change that forced it.

**Out of scope**:
- 1.7 RC/beta versions — stable 1.6.x only.
- Peer-range changes (plan 005 owns the manifest; if 005 already landed, leave its floors; the peer cap question for <1.6 disappears once this plan lands).
- Any refactor of the adapter beyond adding the missing interface members.

## Git workflow

- Branch: `advisor/008-ba-1.6-compat`
- Commits: `chore: upgrade better-auth to 1.6.x`, `feat: implement consumeOne in payload adapter`, `test: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bump the better-auth family

Set `better-auth` and every `@better-auth/*` devDependency to the same latest 1.6.x (`pnpm view better-auth version` — 1.6.25 at plan time; use whatever latest 1.6.x is now). `pnpm install`.

**Verify**: `pnpm install` exit 0; `node -e "console.log(require('packages/payload-auth/node_modules/better-auth/package.json').version)"` → the chosen 1.6.x.

### Step 2: Rebuild and triage compile breaks

`pnpm build`. Expect type errors where BA 1.5→1.6 changed APIs the plugin touches (middleware ctx shapes, `getOAuthState`, plugin option types). Fix minimally; record each fix + the upstream change in your report.

**Verify**: `pnpm build` → exit 0.

### Step 3: Diff the DBAdapter interface and implement missing members

Open the installed `@better-auth/core` adapter type declarations and list every method the interface expects vs what `adapter/index.ts` returns. Implement each missing one. For `consumeOne` specifically — check the exact signature in the declarations; conceptually it is "find one row matching `where`, delete it, return it (or null)". Implement it with the adapter's existing primitives so all transform/slug logic is reused:

```ts
async consumeOne(data /* { model, where, ... } — match the real signature */) {
  // reuse the existing findOne logic to locate the row (transformed),
  // then the existing delete-by-id path; return the transformed doc or null.
}
```

Requirements: field/where transformation identical to `findOne` (same `convertWhereClause` path), delete by the found row's `id` (not by the original where clause — narrower, closes the double-consume window), return `null` when nothing matched, and errors re-throw per the P1-6 convention (only 404s map to null). Wire it into the `transaction()` callback's adapter object the same way the other methods are.

**Verify**: `pnpm build` exit 0; `grep -n "consumeOne" packages/payload-auth/src/better-auth/adapter/index.ts` → implementation + inclusion in the returned object.

### Step 4: Regression tests for the crash paths

- **Phone OTP (#160)**: in `tests/e2e/`, enable is already there (`phoneNumber` plugin in `tests/dev/index.ts`). Add a test: `sendPhoneNumberOTP` → capture the code via the `testUtils` `captureOTP` harness (see `tests/helpers/`) → `verifyPhoneNumber` → assert success and that the verification row was consumed (count = 0).
- **consumeOne unit-ish test** in `tests/adapter/adapter.test.ts` style: create a verification row via the adapter, `consumeOne` it → returns the row; second `consumeOne` with the same where → returns null.

**Verify**: new tests pass.

### Step 5: Full-organization e2e (#124 closure evidence)

Add `tests/e2e/` coverage: create an org with a member and an invitation via the BA API (`auth.api` org endpoints or adapter), then call the BA endpoint behind "get full organization" (`payload.betterAuth.api.getFullOrganization({ query: { organizationId }, headers })` — find the exact method name in the installed BA types). Assert members and invitations arrays come back. Run once with teams **enabled** in a variant if the test config enables teams (check `tests/dev/index.ts` organization plugin config; if teams are on, assert the call doesn't throw).

**Verify**: test passes → evidence to close issue #124 (or, if the team-join path throws, you have found the remaining gap — report it with the stack).

### Step 6: Full suite

**Verify**: `pnpm test:run` → all pass. Pay attention to the admin-invite, social-login, and role middleware suites — they touch the BA APIs most likely to have shifted in 1.6.

## Test plan

Steps 4–5: phone-OTP e2e, consumeOne double-consume unit test, full-organization e2e. Plus the entire existing suite as the upgrade fence.

## Done criteria

- [ ] better-auth family at latest 1.6.x in devDependencies; lockfile in sync
- [ ] Every method in the installed `DBAdapter` interface is implemented by the adapter (list the diff in your report)
- [ ] `verifyPhoneNumber` e2e passes; double-`consumeOne` returns null the second time
- [ ] Full-organization e2e passes (or the residual gap is precisely reported)
- [ ] `pnpm build` and `pnpm test:run` exit 0
- [ ] `generated-types.ts` regenerated (not hand-edited)
- [ ] No out-of-scope files modified beyond reported compile fixes (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- BA 1.6 renamed/removed an API the plugin's middleware relies on (`getOAuthState`, `additionalData`, admin plugin internals) and the fix is not mechanical — report the design question instead of guessing.
- The `DBAdapter` interface diff reveals more than three missing methods (that's an interface-generation change worth discussing, not silently implementing).
- More than ~10 existing tests fail after the bump and the failures aren't a single obvious cause.
- `consumeOne`'s real signature involves locking/versioning semantics beyond find+delete (report the signature; don't approximate).

## Maintenance notes

- After landing: comment on and close #160 (with the release version), and #124 if step 5 proves it fixed; note the OAuth-replay advisory is now behind us.
- Coordinate with plan 005: if 005 hasn't landed, don't let this plan's `pnpm install` regenerate conflicting manifest edits; land 005's manifest first or rebase.
- BA 1.7 is in RC — when it stabilizes, repeat step 3's interface diff; the adapter's missing-member failure mode (#160) is exactly what to re-check each BA minor.
- The admin-invite middleware (plan 003 / backlog ADAPTER-11) can be migrated to `consumeOne` for atomic token consumption — natural follow-up once both land.
