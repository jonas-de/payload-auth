# Plan 007: Stop leaking auth secrets into the admin login page HTML (land PR #153)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/plugin/lib/apply-ba-admin-config.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P0 — highest-severity finding in the repo; ship before everything else
- **Effort**: S
- **Risk**: LOW (removal-only change; nothing client-side ever needed the secrets)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `90411f2`, 2026-07-29
- **Origin**: open PR https://github.com/payload-auth/payload-auth/pull/153 (community fix, unmerged since 2026-04-23)

## Why this matters

`applyBetterAuthAdminConfig` passes the entire `pluginOptions` object as `serverProps` to six admin view/component registrations. Payload serializes view `serverProps` into the admin client config, which is embedded in the RSC payload of the HTML response. Per the PR's reproduction, `betterAuthOptions.secret` and every `socialProviders[*].clientSecret` are readable in cleartext by **any unauthenticated visitor** who views the source of `/admin/login`:

```bash
curl -s http://localhost:3000/admin/login \
  | grep -oE '\\"secret\\":\\"[^\\]*\\"|\\"clientSecret\\":\\"[^\\]*\\"'
```

The BA `secret` signs sessions and tokens — leaking it is full session-forgery capability. A community fix has been open and ignored since April.

## Current state

Verified at `90411f2`: `packages/payload-auth/src/better-auth/plugin/lib/apply-ba-admin-config.ts` passes raw `pluginOptions` in `serverProps` at lines 35, 53, 64, 75, 84, 97 (components `RSCRedirect`, `AdminLogin`, `AdminSignup`, `ForgotPassword`, `ResetPassword`, `TwoFactorVerify`). Excerpt (lines 32–38):

```ts
        {
          path: "payload-auth/better-auth/plugin/rsc#RSCRedirect",
          serverProps: {
            pluginOptions,
            redirectTo: `${config.routes?.admin === undefined ? "/admin" : config.routes.admin.replace(/\/+$/, "")}${adminRoutes.adminLogin}`
          }
        },
```

PR #153 adds `packages/payload-auth/src/better-auth/plugin/lib/strip-secrets.ts` with `stripSecretsFromPluginOptions()` (shallow-clone; removes `betterAuthOptions.secret` and each `socialProviders[*].clientSecret`, preserves `clientId`), swaps all six sites to the stripped copy, and adds `tests/plugin/strip-secrets.test.ts` (8 tests asserting sentinel values don't survive `JSON.stringify(config.admin)`). The PR's diff context matches current `main` line-for-line, so it should apply cleanly.

Known secret-bearing keys in `BetterAuthOptions` beyond the two the PR covers — check and strip these too if present: `emailAndPassword.password` (custom hash config is functions — unserializable, but strip defensively), `plugins` entries can carry provider secrets (e.g. generic OAuth configs), and `database`/adapter internals. The RSC views actually consume only a handful of keys (`betterAuthOptions.baseURL`, `basePath`, `appName`, `emailAndPassword.enabled`, `socialProviders[*].clientId`-level info, `loginMethods`-related options, `adminInvitations`, `users`, plugin presence checks) — grep each view under `payload/views/` for `pluginOptions.` to enumerate.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Fetch the PR | `git fetch https://github.com/payload-auth/payload-auth.git refs/pull/153/head:pr-153` | branch created |
| Apply onto working branch | `git cherry-pick <pr-153 commit(s)>` or `git diff main...pr-153 \| git apply` | clean apply |
| Build | `cd packages/payload-auth && pnpm build` | exit 0 |
| New tests | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/plugin/strip-secrets.test.ts` | pass |
| Full suite (needs plan-001 DB, else skip) | `pnpm test:run` | pass |

## Scope

**In scope**:
- `packages/payload-auth/src/better-auth/plugin/lib/apply-ba-admin-config.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/strip-secrets.ts` (new, from PR)
- `packages/payload-auth/src/better-auth/tests/plugin/strip-secrets.test.ts` (new, from PR; extend)

**Out of scope**:
- Refactoring views to take a minimal allowlist of props (better long-term design — recorded as follow-up, too invasive for the urgent fix).
- Any other admin-config change.

## Git workflow

- Branch: `advisor/007-strip-secrets`
- Preserve the PR author's commit(s) via cherry-pick where possible (credit); follow-up commits conventional, e.g. `security: strip additional secret-bearing keys from serverProps`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Apply PR #153

Fetch and cherry-pick/apply the PR's commits onto your branch. Resolve trivial conflicts only.

**Verify**: `grep -c "safePluginOptions" packages/payload-auth/src/better-auth/plugin/lib/apply-ba-admin-config.ts` → 6. `pnpm build` → exit 0.

### Step 2: Audit what the views actually read, extend stripping

`grep -rn "pluginOptions\." packages/payload-auth/src/better-auth/plugin/payload/views/ packages/payload-auth/src/better-auth/plugin/payload/exports/` and list every key consumed. Extend `stripSecretsFromPluginOptions` to also remove any secret-bearing key not consumed by the views (at minimum, scan for keys named like `/secret|token|apiKey|privateKey|password/i` inside `betterAuthOptions.plugins` entries — if plugin configs are plain objects with such keys, null them; functions are dropped by serialization anyway). Keep `clientId` and everything the grep proved the views need.

**Verify**: extend `strip-secrets.test.ts` with a sentinel in a fake plugin config (`plugins: [{ id: "x", options: { apiKey: "SENTINEL" } }]`) and assert it does not survive `JSON.stringify` of the resulting admin config.

### Step 3: (If a runnable dev environment exists) reproduce before/after

Run the demo or test dev server, `curl -s http://localhost:3000/admin/login | grep -c 'SENTINEL-OR-REAL-SECRET-PATTERN'` before (>0) and after (0) the fix. If no environment is available, state so in the report — the serialization-level test from step 2 stands in.

### Step 4: Full suite

**Verify**: `pnpm test:run` (with plan-001 DB) → all pass; otherwise run the non-DB specs including `strip-secrets.test.ts`.

## Test plan

The PR's 8 tests + step 2's plugin-config sentinel test. Assertion style: stringify the built admin config and assert sentinel absence — this catches any future re-introduction regardless of which component leaks.

## Done criteria

- [ ] All 6 `serverProps` sites use the stripped options
- [ ] `strip-secrets.test.ts` passes, including the added plugin-config case
- [ ] `pnpm build` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The PR does not apply and manual conflict resolution would change its semantics.
- Step 2's grep shows a view genuinely consumes `betterAuthOptions.secret` or a `clientSecret` at render time (would mean stripping breaks a flow — report which).
- Any existing admin-view test fails after the change.

## Maintenance notes

- **Operator, on landing this: cut a patch release immediately** (the fix is worthless unpublished — see issue #154 for precedent of fixes sitting unreleased), close PR #153 with credit to its author, and **advise users in the release notes to rotate `betterAuthOptions.secret` and all social provider client secrets** — any production deployment to date must assume those values are compromised (they were served in HTML to every login-page visitor).
- Follow-up (backlog): invert the model — pass each view an explicit allowlist of the props it needs instead of the whole options object, so new secret-bearing options are safe by default.
- Reviewer: confirm `RSCRedirect`/`afterLogin` (line 35 site) still functions — it's the one component rendered on every admin page.
