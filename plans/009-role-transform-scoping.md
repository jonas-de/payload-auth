# Plan 009: Scope role transformation to the users collection (fix member/invitation writes and impersonation)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/adapter/transform/index.ts packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/admin-role-middleware.ts`
> If in-scope files changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (role storage format is load-bearing for admin access; migration note required for the case-folding change)
- **Depends on**: plans/001-portable-test-infra.md (for the e2e tests)
- **Category**: bug
- **Planned at**: commit `90411f2`, 2026-07-29
- **Origin**: GitHub issues #112 (org member/invitation creation fails) and #128 (impersonate `TypeError: .split is not a function`), plus audit finding ADAPTER-10 (role values force-lowercased)

## Why this matters

The adapter transforms **any** field named `role`/`roles` on **any** model. Three concrete breakages:

1. **#112**: `normalizeData` converts BA's comma-string roles to arrays for every model. The `users` collection stores roles as a `hasMany` select (array — correct), but `member` and `invitation` store `role` as a **text** field expecting the comma-string. Creating an organization fails when the adapter writes `["owner"]` into a text field; users must hand-write `collectionOverrides` hooks to convert back.
2. **#128**: BA's admin plugin `impersonateUser` route does `(targetUser.role || ...).split(",")` — it receives an **array** from our adapter (the array→string conversion in `transformOutput` isn't reaching this path, or the admin middleware's conversion doesn't cover impersonation), so clicking Impersonate in the admin UI throws `TypeError`.
3. **ADAPTER-10**: both branches of the role handling call `.toLowerCase()`, silently rewriting any camelCase configured role (`orgOwner`) into a value that fails the users select-field validation or no longer matches `adminRoles` checks.

## Current state

Verified at `90411f2`.

### `packages/payload-auth/src/better-auth/adapter/transform/index.ts`

`normalizeData` (~lines 351–362) — model-agnostic, lowercasing:

```ts
// Handle role fields (Coming from better auth, will be a single string separated by commas if there are multiple roles)
if (key === "role" || key === "roles") {
  if (Array.isArray(value)) {
    return value.map((role: string) =>
      typeof role === "string" ? role.trim().toLowerCase() : role
    );
  }
  if (typeof value === "string") {
    return value.split(",").map((role: string) => role.trim().toLowerCase());
  }
  return value;
}
```

`transformOutput` (~lines 548–551) — also model-agnostic:

```ts
// Convert role array to comma separated string
if ((targetFieldKey === "role" || targetFieldKey === "roles") && Array.isArray(value)) {
  result[targetFieldKey] = value.join(",")
}
```

### The field-type ground truth

- Users: `role` is a `hasMany` select built from `pluginOptions.users.roles`/`adminRoles` (`plugin/lib/build-collections/users/index.ts`, ~lines 94–100; values used verbatim — casing preserved).
- Member/invitation: `role` is a plain text field holding BA's comma-string (see `plugin/lib/build-collections/members.ts` and `invitations.ts`).
- `plugin/lib/sanitize-better-auth-options/utils/admin-role-middleware.ts` converts users' array↔string around **admin-plugin routes** (see its route matching — read the file top to bottom before editing anything; tests in `tests/plugin/admin-role-middleware.test.ts` and `tests/plugin/role-handling.test.ts`).

### Why impersonate still breaks (#128)

BA's impersonate route reads the **target user** through the adapter (`targetUser.role`) and calls `.split(",")`. Trace the path: if `transformOutput` converts array→string for the user model (excerpt above), the target user should arrive as a string — reproduce first to find where the array leaks through (candidate: the route fetches the user via a path that bypasses `transformOutput`'s role branch, e.g. the `key`/`targetFieldKey` mismatch when the value sits under a different key, or the internal adapter's `findOne` with `select`). Do not assume; reproduce with a failing e2e test before fixing.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test DB | `docker compose -f docker-compose.test.yml up -d` | healthy |
| Role suites | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/plugin/role-handling.test.ts src/better-auth/tests/plugin/admin-role-middleware.test.ts` | pass |
| Transform unit | `pnpm test:run src/better-auth/tests/adapter/transform.test.ts` | pass |
| Full suite | `pnpm test:run` | pass |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:
- `packages/payload-auth/src/better-auth/adapter/transform/index.ts` (the two role branches only)
- `packages/payload-auth/src/better-auth/tests/**` (new/updated tests)
- `packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/admin-role-middleware.ts` **only if** the #128 reproduction proves the fix belongs there — report before editing it.

**Out of scope**:
- Changing how member/invitation store roles (text/comma-string is BA's native format — keep it).
- The users `hasMany` select design (settled; P3-11 documents the bridge).
- Role *hierarchy* enforcement (NEW-9, separate backlog item).

## Git workflow

- Branch: `advisor/009-role-transform-scoping`
- Conventional commits, e.g. `fix: only transform role fields for the user model`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the role conversion field-type-driven, not name-driven

In both branches, decide by what Payload actually stores, not by key name. The transform layer already resolves the collection and has `payload` in scope (see how `isPayloadRelationship(payload, collectionSlug, fieldName)` is called nearby). Add a helper in the same file:

```ts
function isHasManySelectField(payload: any, collectionSlug: string, fieldName: string): boolean {
  // reuse flattenedFieldsCache; return field?.type === "select" && field?.hasMany === true
}
```

- `normalizeData` (input): convert string→array **only** when the target Payload field is a `hasMany` select. Remove `.toLowerCase()` — keep `.trim()`.
- `transformOutput` (output): convert array→string **always** when the value is an array (BA never wants arrays), which is current behavior — but ensure it applies for the users model consistently; no change needed beyond confirming.

Preserve behavior for the users collection (string in → array stored; array out → string). Member/invitation role strings now pass through untouched.

**Verify**: `pnpm test:run src/better-auth/tests/adapter/transform.test.ts src/better-auth/tests/plugin/role-handling.test.ts` → pass (update any test that asserted lowercasing — that assertion is the bug).

### Step 2: Regression tests for #112

e2e (`tests/e2e/`, org plugin already enabled in the test config): create an organization via the BA API as a signed-in user; assert the auto-created owner `member` row exists and its `role` equals `"owner"` (string). Add an invitation and assert its role round-trips.

**Verify**: test passes without any `collectionOverrides` hook.

### Step 3: Reproduce and fix #128 (impersonate)

e2e: sign in as an admin (helpers in `tests/helpers/auth.ts`), call `payload.betterAuth.api.impersonateUser({ body: { userId: <target> }, headers })`, assert no throw and an impersonated session returns. If it throws the `.split` TypeError, trace where the array survives (log the target user shape at the adapter boundary) and fix at the **adapter/transform** level so BA-bound user documents always carry `role` as a string. Report the root cause in your summary.

**Verify**: impersonate e2e passes.

### Step 4: Case-preservation test (ADAPTER-10)

Unit test: `normalizeData`-through-`transformInput` with role string `"orgOwner,editor"` for the users model → stored array `["orgOwner", "editor"]` (casing intact). Note in the plan report: deployments that relied on implicit lowercasing (configured `Admin` but stored `admin`) will see behavior change — flag for the release notes.

**Verify**: test passes.

### Step 5: Full suite + build

**Verify**: `pnpm test:run` all pass; `pnpm build` exit 0.

## Test plan

Steps 2–4: org-create member-role e2e, invitation role round-trip, impersonate e2e, camelCase preservation unit test. Update any existing test asserting lowercased roles.

## Done criteria

- [ ] Role string→array conversion happens only for `hasMany` select fields
- [ ] No `.toLowerCase()` in the role branches
- [ ] Org creation e2e passes with no override hooks
- [ ] Impersonate e2e passes; root cause of #128 documented in the report
- [ ] `pnpm test:run` and `pnpm build` exit 0
- [ ] No out-of-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The transform helpers can't see the Payload field config where `normalizeData` runs (signature threading needed beyond one parameter) — report the required refactor.
- #128's array leak originates inside Better Auth itself (not our adapter) — report with the trace; the fix would then be an upstream issue + a local workaround decision.
- Existing role tests encode the lowercasing as intended behavior with a comment saying why — that would contradict this plan's premise; report before changing.

## Maintenance notes

- Release notes must mention the case-preservation change (see step 4) and that member/invitation `collectionOverrides` role-conversion workarounds (issue #112's) can be removed.
- After landing: comment/close #112 and #128 with the release version.
- Any future collection builder adding a `role`-named field gets correct behavior automatically (type-driven), but a *user* collection override that changes `role` to a text field would change conversion behavior — the type-driven rule makes that correct, worth one line in the docs.
