# Plan 003: Close the four outstanding security/integrity items from the March 2026 review

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/plugin/helpers/generate-verify-email-url.ts packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/ packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/hooks/before-delete.ts packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/api-key-plugin.ts packages/payload-auth/src/better-auth/plugin/lib/build-collections/admin-invitations/ packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/endpoints/generate-invite-url.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches signup/invite middleware and user deletion)
- **Depends on**: plans/001-portable-test-infra.md (to run the integration tests)
- **Category**: security
- **Planned at**: commit `90411f2`, 2026-07-29

## Why this matters

The repo's internal review of March 2026 (`dev-docs/AUDIT_REPORT_REVIEW.md`) flagged four items for fixing "before release"; all four are still present in the code today, four months later:

1. **NEW-1**: the email-verification URL embeds an unvalidated `callbackURL` → open-redirect/phishing vector in a trusted email.
2. **NEW-2**: admin invite tokens never expire → a leaked token (logs, email archive, browser history) mints an admin account at any future time.
3. **NEW-3**: the user `beforeDelete` cascade hook swallows errors and lets the user deletion proceed → orphaned sessions/accounts referencing a deleted user.
4. **P2-12 regression**: the API-key plugin configurator lost its `userId.references.model` wiring during the BA v1.5 upgrade → wrong foreign-key target when custom collection slugs are used.

## Current state

All excerpts verified at commit `90411f2`.

### (a) `packages/payload-auth/src/better-auth/plugin/helpers/generate-verify-email-url.ts` (~line 62)

```ts
// Build the verification URL
const verifyUrl = `${verifyRouteUrl}?token=${jwt}${callbackURL ? `&callbackURL=${encodeURIComponent(callbackURL)}` : ""}`;
```

`callbackURL` is caller-supplied and never validated. The repo already has a URL-safety helper with exactly the right semantics: `packages/payload-auth/src/better-auth/plugin/payload/utils/get-safe-redirect.ts` exports `getSafeRedirect(redirectParam, fallback)` which returns the fallback unless the value is a safe relative path. (Known limitation: its prefix-check approach has a separate hardening finding; using it here is still strictly better than no validation, and the hardening lands in that helper, benefiting this call site automatically.)

### (b) Invite-token validation — two files, no expiry anywhere

`packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/require-admin-invite-for-sign-up-middleware.ts` (~lines 45–57):

```ts
const query: Where = {
  field: "token",
  value: adminInviteToken,
  operator: "eq"
};
const isValidAdminInvitation = await ctx.context.adapter.count({
  model: pluginOptions.adminInvitations?.slug ?? baseSlugs.adminInvitations,
  where: [query]
});
```

`packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/admin-invite-after-signup-middleware.ts` (~lines 55–84) does `adapter.findOne({ model: adminInvitationCollectionSlug, where: [{ field: "token", ... }] })`, checks only `!adminInvitation || !adminInvitation?.role`, then immediately deletes the invitation by id (intentional single-use consumption — preserve that).

The admin-invitations collection builder (`packages/payload-auth/src/better-auth/plugin/lib/build-collections/admin-invitations/index.ts`) defines fields `role` (select), `token` (text), `url` (text) — **no `expiresAt` field exists**. Tokens are minted in `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/endpoints/generate-invite-url.ts` (`crypto.randomUUID()`, then a `payload.create` on the admin-invitations collection — locate the `create` call in that file).

### (c) `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/hooks/before-delete.ts` (~lines 115–121)

```ts
} catch (error) {
  await killTransaction(req);
  console.error("Error in user beforeDelete hook:", error);
  return;   // ← user deletion proceeds despite failed cascade
}
```

Payload aborts the delete when a `beforeDelete` hook **throws**; returning normally lets the delete proceed.

### (d) `packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/api-key-plugin.ts` (entire file, 20 lines)

```ts
export function configureApiKeyPlugin(
  plugin: any,
  resolvedSchemas: BetterAuthSchemas
): void {
  const model = baModelKey.apikey;
  set(
    plugin,
    `schema.${model}.modelName`,
    getSchemaCollectionSlug(resolvedSchemas, model)
  );
}
```

Compare `sso-plugin.ts` / `oidc-plugin.ts` in the same directory, which additionally set `fields.userId.fieldName` and `fields.userId.references.model`. The imports needed (`getSchemaFieldName`, `baModelFieldKeys`) are already partially present in this file.

### Conventions

- Double quotes, semicolons. Conventional commits.
- Adapter `Where` conditions support operators like `eq`, `gt`, `lt` (see usages across `sanitize-better-auth-options/utils/`).
- Existing test patterns: configurator unit tests → `packages/payload-auth/src/better-auth/tests/plugin/organizations-plugin.test.ts`; hook tests → `tests/plugin/before-delete-hook.test.ts`; invite/endpoint tests → `tests/plugin/endpoint-auth.test.ts` and `tests/plugin/set-admin-role.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test DB up | `docker compose -f docker-compose.test.yml up -d` (from plan 001) | healthy |
| Migrate | `cd packages/payload-auth && pnpm test:payload migrate` | exit 0 |
| Full tests | `cd packages/payload-auth && pnpm test:run` | all pass |
| Single file | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/plugin/<file>` | passes |
| Build | `cd packages/payload-auth && pnpm build` | exit 0 |
| New migration (step 2) | `cd packages/payload-auth && pnpm test:payload migrate:create` | migration file created |

## Scope

**In scope**:
- `packages/payload-auth/src/better-auth/plugin/helpers/generate-verify-email-url.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/build-collections/admin-invitations/index.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/endpoints/generate-invite-url.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/require-admin-invite-for-sign-up-middleware.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/admin-invite-after-signup-middleware.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/hooks/before-delete.ts`
- `packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/api-key-plugin.ts`
- `packages/payload-auth/src/better-auth/tests/**` (add/extend tests)
- `packages/payload-auth/src/better-auth/tests/dev/migrations/**` (new migration for the `expiresAt` field)
- `dev-docs/AUDIT_REPORT_REVIEW.md` (mark the four items fixed, matching the style used in `AUDIT-REPORT.md`)

**Out of scope**:
- `get-safe-redirect.ts` hardening (control-character bypass) — separate recorded finding; do not modify that helper here.
- The invite-consumption error-handling gap in `admin-invite-after-signup-middleware.ts` (token deleted before role assignment with no compensation) — separate recorded finding (ADAPTER-11); do not restructure the middleware's delete/update ordering.
- `send-invite-url.ts` — no changes needed.

## Git workflow

- Branch: `advisor/003-march-security-punchlist`
- One conventional commit per lettered item, e.g. `fix: validate callbackURL in email verification links`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Validate `callbackURL` (NEW-1)

In `generate-verify-email-url.ts`, import `getSafeRedirect` from `@/better-auth/plugin/payload/utils/get-safe-redirect` and pass the callback through it before embedding. A rejected value should result in **omitting** the `callbackURL` param (empty fallback), not embedding the fallback:

```ts
const safeCallbackURL = callbackURL ? getSafeRedirect(callbackURL, "") : "";
const verifyUrl = `${verifyRouteUrl}?token=${jwt}${safeCallbackURL ? `&callbackURL=${encodeURIComponent(safeCallbackURL)}` : ""}`;
```

Note: if `getSafeRedirect`'s current signature or behavior differs from `(param, fallback) => string`, STOP.

**Verify**: add unit test (step 6) covering `https://evil.com`, `//evil.com`, and `/admin` inputs → only `/admin` survives.

### Step 2: Add `expiresAt` to admin invitations (NEW-2)

1. In the admin-invitations collection builder, add a required date field after `token`:
   ```ts
   {
     name: "expiresAt",
     type: "date",
     required: true,
     admin: { readOnly: true, description: "The invitation is invalid after this time." }
   }
   ```
   Match the exact field-definition style of the neighboring `token` field (including any `saveToJWT`/`custom` conventions the file uses).
2. In `generate-invite-url.ts`, when creating the invitation record, set `expiresAt` to now + 7 days: `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()`. If `pluginOptions.adminInvitations` has an options type nearby, add an optional `expiresInMs?: number` (default 7 days) — keep the default behavior when unset.
3. In `require-admin-invite-for-sign-up-middleware.ts`, add a second condition to the `count` query: `{ field: "expiresAt", value: new Date(), operator: "gt" }` (both conditions in the `where` array — Better Auth treats multiple conditions as AND).
4. In `admin-invite-after-signup-middleware.ts`, after the `findOne`, reject (treat as no invitation: call `originalAfter` and return, same as the existing `!adminInvitation` branch) when `new Date(adminInvitation.expiresAt) <= new Date()`. **Important**: in the expired case, do NOT delete the invitation and do NOT assign the role.
5. Generate a migration for the new column: `pnpm test:payload migrate:create` and commit the generated file.

**Verify**: `pnpm test:run src/better-auth/tests/plugin/set-admin-role.test.ts` → existing invite tests still pass (they create invitations via the collection — they will now need `expiresAt`; update fixtures accordingly).

### Step 3: Re-throw cascade failures (NEW-3)

In `before-delete.ts`, change the catch block to re-throw after cleanup:

```ts
} catch (error) {
  await killTransaction(req);
  console.error("Error in user beforeDelete hook:", error);
  throw error;
}
```

**Verify**: `pnpm test:run src/better-auth/tests/plugin/before-delete-hook.test.ts` → update/extend: the existing "logs error" test now also asserts the hook rejects (`await expect(hook(...)).rejects.toThrow()`).

### Step 4: Restore API-key `userId` references (P2-12 regression)

In `api-key-plugin.ts`, after the `modelName` set, add (mirroring `sso-plugin.ts`'s pattern exactly — open that file and copy its structure):

```ts
set(
  plugin,
  `schema.${model}.fields.userId.fieldName`,
  getSchemaFieldName(resolvedSchemas, model, baModelFieldKeys.apikey.userId)
);
set(
  plugin,
  `schema.${model}.fields.userId.references.model`,
  getSchemaCollectionSlug(resolvedSchemas, baModelKey.user)
);
```

Check `constants.ts` for the exact `baModelFieldKeys` accessor the sibling configurators use; if `baModelFieldKeys.apikey` doesn't exist, use the literal `"userId"` as the sibling files do.

**Verify**: new unit test (step 6) asserts `plugin.schema.apikey.fields.userId.references.model` equals the users slug, including with a custom users slug — model it on the P0-2 regression test in `tests/plugin/organizations-plugin.test.ts`.

### Step 5: Mark the items fixed in `dev-docs/AUDIT_REPORT_REVIEW.md`

Update the four entries (P2-12 REGRESSION, NEW-1, NEW-2, NEW-3) with a `— FIXED` status line and one-sentence resolution each, following the format used in `dev-docs/AUDIT-REPORT.md`.

### Step 6: Write the tests listed above

- `tests/plugin/` unit test for the API-key configurator (new file `api-key-plugin.test.ts`, pattern: `organizations-plugin.test.ts`).
- Unit tests for `generate-verify-email-url` callback validation (new file or extend an existing helper test; pure function — no DB needed).
- Extend `set-admin-role.test.ts` (or a new `admin-invite-expiry.test.ts`) with: expired token rejected at signup, non-expired token accepted, expired token NOT consumed.
- Extend `before-delete-hook.test.ts` for the re-throw.

**Verify**: `pnpm test:run` → all pass, including the new tests.

## Test plan

Summarized in step 6. Every lettered fix gets at least one regression test; the invite-expiry tests must cover both middlewares (before-signup rejection and after-signup non-consumption).

## Done criteria

- [ ] `grep -n "getSafeRedirect" packages/payload-auth/src/better-auth/plugin/helpers/generate-verify-email-url.ts` → 1+ match
- [ ] `grep -n "expiresAt" packages/payload-auth/src/better-auth/plugin/lib/build-collections/admin-invitations/index.ts` → 1+ match
- [ ] `grep -n "expiresAt" packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/utils/require-admin-invite-for-sign-up-middleware.ts` → 1+ match
- [ ] `grep -n "throw error" packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/hooks/before-delete.ts` → 1 match
- [ ] `grep -n "references.model" packages/payload-auth/src/better-auth/plugin/lib/sanitize-better-auth-options/api-key-plugin.ts` → 1+ match
- [ ] `pnpm test:run` exits 0 with the new tests present
- [ ] `pnpm build` exits 0
- [ ] A migration file for `expiresAt` exists under `tests/dev/migrations/`
- [ ] `dev-docs/AUDIT_REPORT_REVIEW.md` updated
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt in "Current state" no longer matches (these files are security-sensitive; drift means re-audit, not adaptation).
- `getSafeRedirect` cannot be imported into `helpers/` without creating a client/server boundary problem (it currently lives under `payload/utils/`; if the import drags client-only code into a server path, report instead of relocating files).
- Existing invite-flow tests fail in a way not explained by the new required `expiresAt` field.
- `migrate:create` produces a migration touching tables other than the admin-invitations collection.

## Maintenance notes

- Anyone upgrading existing production databases needs the `expiresAt` migration; existing invitation rows will need a backfill value (the generated migration should set a default for existing rows — reviewer must check this).
- The after-signup middleware still deletes the token before assigning the role with no compensation on failure — recorded separately (ADAPTER-11 in `plans/README.md` backlog); revisit when touching that middleware.
- When `get-safe-redirect.ts` is hardened (separate backlog item), the NEW-1 fix inherits the improvement automatically.
