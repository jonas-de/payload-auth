# Plan 006: Fix the four 2FA admin-panel lockout bugs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/plugin/payload/views/two-factor-verify/ packages/payload-auth/src/better-auth/plugin/payload/components/two-factor-auth/ packages/payload-auth/src/better-auth/plugin/payload/components/login-form/context.tsx packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/index.ts packages/payload-auth/src/shared/form/validation.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (login-path UI; a mistake here locks admins out — test manually)
- **Depends on**: none (manual verification possible without plans 001/002; unit tests benefit from 001)
- **Category**: bug
- **Planned at**: commit `90411f2`, 2026-07-29

## Why this matters

Four independent bugs each brick the admin-panel 2FA experience under common configurations:

1. **Digits mismatch**: the OTP form enforces `length(twoFactorDigits)` AND a hardcoded `/^\d{6}$/` — with 8-digit TOTP configured the two constraints are unsatisfiable, so no 2FA user can ever pass the challenge.
2. **Unwired client props**: the account-view `TwoFactorAuth` component is registered with **no** `clientProps`, so its auth client is built with `baseURL: undefined, basePath: undefined`; with any non-default `basePath` or cross-origin auth server, 2FA enrollment from the admin panel hits the wrong endpoint. The `AdminButtons` component gets `baseURL` passed **raw** (may be a `BaseURLConfig` object) instead of through `resolveBaseURL` like every other call site.
3. **Cookie-name guess**: the 2FA verify view looks up the challenge cookie as `` `${NODE_ENV === "production" ? "__Secure-" : ""}better-auth.two_factor` `` — but Better Auth derives the `__Secure-` prefix from `useSecureCookies`/URL protocol and supports a configurable `cookiePrefix`; any of those configurations makes the lookup miss and bounce users to login in an infinite loop.
4. **Broken deep-link redirect**: after password success, a 2FA user is pushed to `` `${redirectUrl.split("?")[0]}${adminRoutes.twoFactorVerify}?redirect=${redirectUrl}` `` — the prefix is the redirect *target*, not the admin route. Deep links (`?redirect=/admin/collections/posts`) land on a non-existent route and the user cannot complete login.

## Current state

All excerpts verified at `90411f2`.

### (1) `packages/payload-auth/src/better-auth/plugin/payload/views/two-factor-verify/client.tsx` (~lines 33–38)

```tsx
const otpSchema = z.object({
  code: z
    .string()
    .length(twoFactorDigits, `Code must be ${twoFactorDigits} digits`)
    .refine((val) => /^\d{6}$/.test(val), "Code must be numeric")
});
```

(`twoFactorDigits` is a prop with default 6, fed from `totpOptions.digits` by the server view.) The label lower in the file is the hardcoded string `"6-digit Code"` — find it with `grep -n "6-digit" client.tsx`.

### Also (1) `packages/payload-auth/src/better-auth/plugin/payload/components/two-factor-auth/index.tsx` (~lines 63–72)

```tsx
const otpSchema = z.object({
  otp: z
    .string()
    .length(6, "Code must be 6 digits")
    .refine((val) => /^\d{6}$/.test(val), "Code must be numeric")
});
```

This component receives no digits prop at all: `interface TwoFactorAuthProps { baseURL?: string; basePath?: string; }` (~line 26).

### (2) `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/index.ts`

The `twoFactorEnabled` field (~lines 118–129) registers the component with no props:

```ts
twoFactorEnabled: () => ({
  defaultValue: false,
  admin: {
    description: "Whether the user has two factor authentication enabled",
    components: {
      Field: {
        path: "payload-auth/better-auth/plugin/client#TwoFactorAuth"
      }
    }
  }
}),
```

And (~lines 236–243) `AdminButtons` gets the raw config object:

```ts
Component: {
  path: "payload-auth/better-auth/plugin/client#AdminButtons",
  clientProps: {
    userSlug,
    baseURL: pluginOptions.betterAuthOptions?.baseURL,   // ← may be a BaseURLConfig object
    basePath: pluginOptions.betterAuthOptions?.basePath
  }
},
```

The correct pattern exists at six other call sites, e.g. `payload/views/two-factor-verify/index.tsx:78`:

```tsx
baseURL={resolveBaseURL(pluginOptions.betterAuthOptions?.baseURL, req.headers)}
```

`resolveBaseURL(baseURL?, headers?)` lives at `packages/payload-auth/src/better-auth/plugin/payload/utils/resolve-base-url.ts` — for a string config it returns it unchanged; for a dynamic (`allowedHosts`) config it needs request headers, else returns the `fallback`. **Constraint**: `users/index.ts` builds collection config at init time with no request, so pass `resolveBaseURL(pluginOptions.betterAuthOptions?.baseURL)` (no headers) — correct for string configs, falls back to `fallback` for dynamic configs. That is strictly better than passing the object.

### (3) `packages/payload-auth/src/better-auth/plugin/payload/views/two-factor-verify/index.tsx` (~lines 51–56)

```tsx
const twoFactorCookie = cookieStore.get(
  `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}better-auth.two_factor`
)?.value;
if (!twoFactorCookie) {
  redirect(`${adminRoute}${loginRoute}`);
}
```

The codebase's convention for cookie names is to read them from the Better Auth context: `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/hooks/after-logout.ts:12-14` uses `(await payload.betterAuth.$context).authCookies`, and `refresh-token.ts` uses `authContext.authCookies.sessionToken.name`. The view already has `payload` (it calls `payload.count` at ~line 61) — investigate `authCookies` and the BA context's cookie helpers for the two-factor cookie entry; Better Auth's twoFactor plugin creates the cookie via the context's cookie factory, so its resolved name/prefix should be derivable from the context. If `authCookies` has no two-factor entry, derive prefix + secure flag from `$context.options.advanced?.cookiePrefix` and the context's `useSecureCookies`-equivalent, mirroring how `authCookies.sessionToken.name` is constructed.

### (4) `packages/payload-auth/src/better-auth/plugin/payload/components/login-form/context.tsx` (~line 98)

```tsx
twoFactorClient({
  onTwoFactorRedirect() {
    router.push(
      `${redirectUrl.split("?")[0]}${adminRoutes.twoFactorVerify}?redirect=${redirectUrl}`
    );
  }
}),
```

The view is registered at `${adminRoute}/two-factor-verify` (see `packages/payload-auth/src/better-auth/plugin/lib/apply-ba-admin-config.ts` ~lines 92–93, path constant `adminRoutes.twoFactorVerify`). `LoginFormProvider` receives props from the admin-login server view (`payload/views/admin-login/index.tsx` — find where `LoginFormProvider`/`LoginForm` is rendered and what props it already gets; `redirectUrl` is already threaded, so add `adminRoute` beside it). The Payload admin route is available server-side as `config.routes.admin` (the view already computes `adminRoute` — grep for it in `admin-login/index.tsx`).

### Conventions

- Client components use double quotes/semicolons; z-schema + `useAppForm` (TanStack) forms.
- Pure form-validation helpers live in `packages/payload-auth/src/shared/form/validation.ts` and are unit-testable without a DOM (see `usernameField`, `passwordField` factories there).
- Component test infrastructure does not exist (vitest `include` is `src/**/*.test.ts`, node environment) — that is why step 5 extracts logic instead of rendering components.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build | `cd packages/payload-auth && pnpm build` | exit 0 |
| Unit tests | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/plugin/` | pass |
| Full suite (needs plan-001 DB) | `cd packages/payload-auth && pnpm test:run` | pass |
| Manual run (optional but recommended) | root `pnpm dev` (runs package watch + demo) | admin login flow reachable |

## Scope

**In scope**:
- `packages/payload-auth/src/better-auth/plugin/payload/views/two-factor-verify/client.tsx`
- `packages/payload-auth/src/better-auth/plugin/payload/views/two-factor-verify/index.tsx`
- `packages/payload-auth/src/better-auth/plugin/payload/components/two-factor-auth/index.tsx`
- `packages/payload-auth/src/better-auth/plugin/payload/components/login-form/context.tsx`
- `packages/payload-auth/src/better-auth/plugin/payload/views/admin-login/index.tsx` (only to thread `adminRoute` into the login form provider)
- `packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/index.ts` (only the two component registrations)
- `packages/payload-auth/src/shared/form/validation.ts` (add `otpField` factory)
- `packages/payload-auth/src/better-auth/tests/**` (new unit tests)

**Out of scope**:
- The other login-form findings (dead loading state, hydration-unsafe error param, soft-vs-hard navigation after success) — recorded separately; do not fix opportunistically.
- `two-factor-auth/index.tsx` restructuring (nested component definitions) — separate recorded finding; only touch the schema and props.
- `resolveBaseURL` itself.
- Any server endpoint or middleware.

## Git workflow

- Branch: `advisor/006-2fa-lockouts`
- Conventional commits per numbered fix, e.g. `fix: OTP validation honors configured TOTP digit count`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a shared `otpField` factory and use it in both forms

In `packages/payload-auth/src/shared/form/validation.ts`, add (matching the file's existing factory style):

```ts
export const otpField = ({ digits = 6 }: { digits?: number } = {}) =>
  z
    .string()
    .length(digits, `Code must be ${digits} digits`)
    .refine((val) => /^\d+$/.test(val), "Code must be numeric");
```

- In `two-factor-verify/client.tsx`: replace the inline schema with `code: otpField({ digits: twoFactorDigits })`; replace the hardcoded `"6-digit Code"` label with a template using `twoFactorDigits`.
- In `two-factor-auth/index.tsx`: add `twoFactorDigits?: number` to `TwoFactorAuthProps` (default 6), replace the inline schema with `otp: otpField({ digits: twoFactorDigits })`.

**Verify**: `grep -rn "\\\\d{6}" packages/payload-auth/src` → no matches. `pnpm build` → exit 0.

### Step 2: Wire the `twoFactorEnabled` clientProps and fix `AdminButtons` baseURL

In `users/index.ts`:

- `twoFactorEnabled` field registration: add
  ```ts
  clientProps: {
    baseURL: resolveBaseURL(pluginOptions.betterAuthOptions?.baseURL),
    basePath: pluginOptions.betterAuthOptions?.basePath,
    twoFactorDigits: /* totpOptions.digits from the twoFactor plugin options — mirror how
       payload/views/two-factor-verify/index.tsx:48-49 extracts it via supportedBAPluginIds.twoFactor */
  }
  ```
  Import `resolveBaseURL` from `@/better-auth/plugin/payload/utils/resolve-base-url` and check the twoFactor plugin options lookup pattern in `two-factor-verify/index.tsx` (~lines 46–50) — replicate it here.
- `AdminButtons` registration: change `baseURL: pluginOptions.betterAuthOptions?.baseURL` → `baseURL: resolveBaseURL(pluginOptions.betterAuthOptions?.baseURL)`.

**Verify**: `pnpm build` → exit 0; `grep -n "resolveBaseURL" packages/payload-auth/src/better-auth/plugin/lib/build-collections/users/index.ts` → 2+ matches. If importing `resolveBaseURL` into `users/index.ts` creates a server/client boundary error at build time, STOP.

### Step 3: Resolve the two-factor cookie name from the BA context

In `two-factor-verify/index.tsx`, replace the `NODE_ENV`-based name with a context-derived one. Investigation order (stop at the first that works):

1. `const authContext = await payload.betterAuth.$context;` — inspect `authContext.authCookies` for a two-factor entry (log its keys in a scratch run).
2. If absent: build the name from the context — Better Auth constructs cookie names as `${securePrefix}${cookiePrefix}.two_factor` where `cookiePrefix = authContext.options.advanced?.cookiePrefix ?? "better-auth"` and the secure prefix follows `authContext.options.advanced?.useSecureCookies ?? baseURL.startsWith("https")`. Verify this rule against the installed `better-auth` source (`node_modules/better-auth/dist/**` — search for `two_factor` and `createCookieGetter`) before relying on it, and cite the file you checked in a code comment is NOT needed — just match the logic.
3. Keep the existing `redirect` fallback behavior when the cookie is absent.

**Verify**: `pnpm build` → exit 0. Manual check (if a dev environment is available): with default config, a password login for a 2FA-enabled user still reaches the verify view (cookie found). If you cannot run the flow, state so in the report and mark this step "needs manual QA".

### Step 4: Fix the 2FA redirect construction

- In `admin-login/index.tsx`, find the existing `adminRoute` value (used elsewhere in the file) and pass it as a new `adminRoute` prop into the login-form provider component alongside `redirectUrl` (follow `redirectUrl`'s threading through `payload/components/login-form/` — likely `index.tsx` → `context.tsx`).
- In `context.tsx`, accept the prop and change the redirect:
  ```tsx
  router.push(
    `${adminRoute}${adminRoutes.twoFactorVerify}?redirect=${encodeURIComponent(redirectUrl)}`
  );
  ```

**Verify**: `pnpm build` → exit 0; `grep -n "split(\"?\")" packages/payload-auth/src/better-auth/plugin/payload/components/login-form/context.tsx` → no matches.

### Step 5: Unit-test the extracted logic

New file `packages/payload-auth/src/better-auth/tests/plugin/otp-validation.test.ts` (pure zod, no DB — pattern: any small unit spec in `tests/plugin/`):

- `otpField()` accepts `"123456"`, rejects `"12345"`, rejects `"abcdef"`.
- `otpField({ digits: 8 })` accepts `"12345678"`, rejects `"123456"` — the regression this plan fixes.

**Verify**: `pnpm test:run src/better-auth/tests/plugin/otp-validation.test.ts` → 5 assertions pass.

### Step 6: Full build + suite

**Verify**: `pnpm build` exit 0; `pnpm test:run` all pass (with plan-001 DB available; otherwise run the non-DB specs and note it).

## Test plan

Step 5 covers the digits logic (the only pure-function slice). Steps 2–4 are wiring changes whose automated coverage would need component-test infrastructure that doesn't exist (recorded backlog item); compensate with the manual QA checklist: (a) default-config 2FA login end-to-end, (b) deep-link login `?redirect=<admin>/collections/users` lands back on that URL after OTP, (c) account-view enable-2FA modal opens and reaches the QR step.

## Done criteria

- [ ] `grep -rn "\\\\d{6}" packages/payload-auth/src` → no matches
- [ ] `otpField` exists in `shared/form/validation.ts`; both 2FA forms use it
- [ ] `twoFactorEnabled` registration passes `clientProps` (baseURL/basePath/twoFactorDigits)
- [ ] `AdminButtons` receives `resolveBaseURL(...)`, not the raw config
- [ ] Two-factor cookie name derived from the BA context, not `NODE_ENV`
- [ ] 2FA redirect built from `adminRoute` with `encodeURIComponent(redirectUrl)`
- [ ] New OTP unit tests pass; `pnpm build` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated (note any "needs manual QA" caveat there)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt doesn't match the live code.
- Step 3's investigation finds Better Auth exposes no reliable way to derive the two-factor cookie name from the context (report findings; do not ship a second guess).
- Threading `adminRoute` requires changing more than the two files named in step 4.
- `resolveBaseURL` import into `users/index.ts` fails the build (client-boundary issue).

## Maintenance notes

- The remaining login-form findings (dead loading state on social/passkey buttons, hydration-unsafe `error` query read, `router.push` vs full page load after passkey/2FA success, nested form-component definitions) are recorded in `plans/README.md` backlog — natural follow-up in the same files.
- When component-test infrastructure lands (jsdom + testing-library, backlog), add render tests for the 2FA verify form with `twoFactorDigits: 8`.
- Reviewer: confirm the `twoFactorDigits` lookup in step 2 handles the twoFactor plugin being disabled (field/component are conditional on the plugin — verify the registration is inside that conditional).
