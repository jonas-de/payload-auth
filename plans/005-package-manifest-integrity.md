# Plan 005: Fix the published package's dependency manifest and type/module resolution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/package.json packages/payload-auth/tsconfig.json packages/payload-auth/.swcrc`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (consumer-facing correctness; nothing here blocks local dev)
- **Effort**: M
- **Risk**: MED (changes what npm consumers install and resolve)
- **Depends on**: none (but plan 001/002 make the verification cheaper)
- **Category**: dependencies / dx
- **Planned at**: commit `90411f2`, 2026-07-29

## Why this matters

The published `payload-auth` package (v1.8.x) has five manifest defects that hit consumers, not this repo:

1. **Phantom dependencies**: shipped code imports `zod` (10 files), `http-status` (2 files), and `@better-auth/core` (runtime value import in the adapter) — none is in `dependencies`/`peerDependencies`. They resolve today only via hoisting luck; strict-isolation consumers (default pnpm, Yarn PnP) get `ERR_MODULE_NOT_FOUND` inside auth endpoints.
2. **Dead weight**: `sonner`, `svix`, `tailwind-merge`, `class-variance-authority`, `uncrypto` are declared as runtime `dependencies` with **zero** imports anywhere in `src` — every consumer installs them (svix is a full webhook SDK) for nothing. `@polar-sh/better-auth` and `@polar-sh/sdk` are unused devDependencies.
3. **Broken `module` field**: `"module": "./dist/index.mjs"` points at a file the build never emits (swc emits `.js` only).
4. **Root export has no types**: `"."` maps to a bare string, so `import ... from "payload-auth"` under modern `moduleResolution` gets no declarations.
5. **Published `.d.ts` files contain `@/` aliases**: `tsc` emits declarations without rewriting `paths`, so `dist/**/*.d.ts` import `"@/better-auth/..."` — unresolvable for consumers; with `skipLibCheck: true` the types silently degrade to `any`.
6. **Peer floors advertise untested/vulnerable versions**: `better-auth >=1.4.0` cannot work (the code imports `@better-auth/core/*` subpaths that exist only from 1.5.x); `payload >=3.69.0` advertises versions below the 3.79.1 pre-auth account-takeover fix (GHSA advisory, patched ≥3.79.1); devDeps pin 3.79.0 — one patch behind that fix.

## Current state

`packages/payload-auth/package.json` at `90411f2` (relevant excerpts):

```json
"main": "./dist/index.js",
"module": "./dist/index.mjs",        // ← never emitted
"types": "./dist/index.d.ts",
"type": "module",
"exports": {
  ".": "./dist/index.js",            // ← bare string, no types condition
  "./better-auth": { "import": ..., "types": ..., "default": ... },   // ← the correct pattern, used by all subpaths
  ...
},
"peerDependencies": {
  "@better-auth/passkey": ">=1.4.0 <2",
  "@payloadcms/next": ">=3.69.0 <4",
  "@payloadcms/ui": ">=3.69.0 <4",
  "better-auth": ">=1.4.0 <2",
  "next": ">=15.4.8 <17",
  "payload": ">=3.69.0 <4",
  "react": ">=19.2.1 <20",
  "react-dom": ">=19.2.1 <20"
},
"dependencies": {
  "@better-auth/utils": "0.3.1",
  "@tanstack/react-form": "1.27.7",
  "class-variance-authority": "0.7.1",   // ← unused
  "clsx": "2.1.1",                        // used (1 file) — keep
  "jose": "6.1.3",                        // used — keep
  "lucide-react": "0.562.0",              // used — keep
  "qrcode.react": "4.2.0",                // used — keep
  "sonner": "2.0.7",                      // ← unused (toasts come from @payloadcms/ui)
  "svix": "1.84.1",                       // ← unused
  "tailwind-merge": "3.4.0",              // ← unused
  "uncrypto": "0.1.3"                     // ← unused
}
```

Wait — before deleting, re-verify each "unused" claim yourself (the audit did, but re-run):
`for p in sonner svix tailwind-merge class-variance-authority uncrypto; do echo "$p: $(grep -rl "$p" src --include='*.ts' --include='*.tsx' | wc -l)"; done` → all `0` at plan time. `sonner` deserves care: the UI components import `toast` — check the import source (`grep -rn "from \"sonner\"\|toast" src --include="*.tsx" | grep import | head`). At plan time no file imports from `"sonner"`; toasts come from `@payloadcms/ui`.

Imports needing declaration (verified at plan time):
- `zod`: 10 shipped files (e.g. `src/shared/form/validation.ts`, `src/better-auth/plugin/lib/build-collections/users/endpoints/send-invite-url.ts`).
- `http-status`: `src/better-auth/plugin/lib/build-collections/users/endpoints/generate-invite-url.ts` and `send-invite-url.ts`.
- `@better-auth/core`: value import in `src/better-auth/adapter/index.ts:1` (`from "@better-auth/core/db/adapter"`), currently devDep `1.5.3` only.

devDependencies pin `better-auth` family at `1.5.3` and `payload`/`@payloadcms/*` at `3.79.0`. Advisories (from `pnpm audit --prod` at plan time): `payload`/`@payloadcms/graphql` < 3.79.1 — critical pre-auth account takeover via password-recovery parameter injection; `better-auth` < 1.6.11 — OAuth refresh-token replay on oidc-provider/mcp plugins (relevant only if those plugins are used, but the floor should not advertise it).

`packages/payload-auth/tsconfig.json`: `"emitDeclarationOnly": true`, `paths: { "@/*": ... }` — tsc copies `@/` specifiers verbatim into `dist/**/*.d.ts`. `.swcrc` rewrites the aliases in emitted JS (`jsc.paths`), so the **JS** is fine; only declarations are broken. 72 non-test files import via `@/`.

`.swcrc` also has a trailing comma after the last `jsc.paths` entry (invalid strict JSON, tolerated by swc) — fix while in the file.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` (root) | exit 0 |
| Build | `cd packages/payload-auth && pnpm build` | exit 0 |
| Alias check | `grep -rn "from \"@/" packages/payload-auth/dist --include="*.d.ts" \| head` | no matches (after step 4) |
| Pack preview | `cd packages/payload-auth && npm pack --dry-run` | file list, no `.mjs` references |
| Demo build (integration check) | `pnpm --filter demo build` | exit 0 (see STOP conditions) |
| Tests | `cd packages/payload-auth && pnpm test:run` | pass (needs plan-001 DB) |

## Scope

**In scope**:
- `packages/payload-auth/package.json`
- `packages/payload-auth/tsconfig.json` / `packages/payload-auth/.swcrc` (only as needed for the alias fix + trailing comma)
- `pnpm-lock.yaml` (regenerated by `pnpm install` after manifest edits — commit the resulting lockfile)

**Out of scope**:
- `.npmrc` `shamefully-hoist=true` removal — desirable follow-up, but it can break the demo/docs builds and needs its own verification pass.
- `demo/` and `docs/` manifests (version-skew is a separate recorded finding).
- Converting relative imports to `@/` or vice versa (separate consistency finding).
- Any `src/**` code change beyond zero — if a step seems to require one, STOP.

## Git workflow

- Branch: `advisor/005-manifest-integrity`
- Conventional commits per step, e.g. `fix: declare zod and http-status as real dependencies`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Declare the phantom dependencies

In `packages/payload-auth/package.json`:

- Add to `dependencies`: `"http-status"` (match the version installed in the workspace: `pnpm why http-status` to find it; pin caret range).
- Add `"zod"` to `peerDependencies` with the range Better Auth itself accepts (check `node_modules/better-auth/package.json` → its `dependencies.zod` or peer range; mirror it, e.g. `"^3.25.0 || ^4.0.0"` — use what you find, not this guess) AND add it to `devDependencies` for local builds. Peer (not direct) so the consumer's tree keeps a single zod instance for `instanceof` safety.
- Add `"@better-auth/core"` to `peerDependencies` as `">=1.5.0 <2"` (keep the 1.5.3 devDep).

**Verify**: `node -e "const p=require('./packages/payload-auth/package.json'); ['http-status'].forEach(d=>{if(!p.dependencies[d])process.exit(1)}); if(!p.peerDependencies['zod']||!p.peerDependencies['@better-auth/core'])process.exit(1)"` → exit 0.

### Step 2: Remove unused dependencies

Delete from `dependencies`: `sonner`, `svix`, `tailwind-merge`, `class-variance-authority`, `uncrypto`. Delete from `devDependencies`: `@polar-sh/better-auth`, `@polar-sh/sdk`. Run the re-verification grep from "Current state" first; skip any package that now has imports.

**Verify**: `pnpm install` exits 0, then `cd packages/payload-auth && pnpm build` exits 0.

### Step 3: Fix `module` and the root export

- Delete the `"module": "./dist/index.mjs"` line.
- Replace `".": "./dist/index.js"` with the same conditional shape the subpaths use:
  ```json
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
  ```
  Note: `types` must come **first** in each conditions object per TypeScript's docs — reorder to `"types"`, `"import"`, `"default"` for the root AND (in the same commit) the existing subpaths, which currently list `import` first. TypeScript tolerates the current order in some resolution modes but the documented contract is types-first.

**Verify**: `npm pack --dry-run 2>&1 | grep -c "index.mjs"` → 0. `node -e "const p=require('./packages/payload-auth/package.json'); if(typeof p.exports['.']==='string')process.exit(1); if(Object.keys(p.exports['.'])[0]!=='types')process.exit(1)"` → exit 0.

### Step 4: Rewrite `@/` aliases in emitted declarations

Add `tsc-alias` as a devDependency of the package and chain it after the tsc step. In `packages/payload-auth/package.json`:

```json
"build:types": "pnpm generate:better-auth-types && tsc --project tsconfig.json && tsc-alias -p tsconfig.json"
```

`tsc-alias` reads the existing `paths` config; no new config file should be needed. Fix the `.swcrc` trailing comma (last entry of `jsc.paths`) in the same commit.

**Verify**: `cd packages/payload-auth && pnpm build` → exit 0, then `grep -rln "from \"@/" dist --include="*.d.ts" | wc -l` → `0` (also check `import("@/` occurrences: `grep -rln "import(\"@/" dist --include="*.d.ts" | wc -l` → `0`).

### Step 5: Raise the peer floors and patch the devDeps

- `"better-auth": ">=1.5.0 <2"`, `"@better-auth/passkey": ">=1.5.0 <2"` (the code imports 1.5-only `@better-auth/core` subpaths).
- `"payload"`, `"@payloadcms/next"`, `"@payloadcms/ui"`: floor `">=3.79.1 <4"` (3.79.1 = the pre-auth account-takeover fix; do not advertise vulnerable floors).
- devDependencies: bump `payload`, `@payloadcms/next`, `@payloadcms/ui`, `@payloadcms/db-postgres` from `3.79.0` to the latest 3.79.x patch (`pnpm view payload@3.79 versions` to pick).
- Leave `next` and `react` ranges as-is.

**Verify**: `pnpm install` exits 0; `pnpm build` exits 0; full test suite passes (`pnpm test:run`, DB from plan 001).

### Step 6: Smoke-test the packed artifact

```bash
cd packages/payload-auth && npm pack   # produces payload-auth-<version>.tgz
cd "$(mktemp -d)" && npm init -y >/dev/null && npm install <absolute path to tgz> --ignore-scripts --no-audit --no-fund --legacy-peer-deps 2>&1 | tail -3
node --input-type=module -e "import('payload-auth').then(m => console.log('root import OK', Object.keys(m).length))"
```

The root import may legitimately fail on peer imports (payload etc. not installed in the temp dir) — the meaningful assertions are: (1) install succeeds, (2) the failure, if any, names a **peer** package, never `zod`/`http-status`/`@better-auth/core`/a `@/` path. Delete the tgz afterwards.

**Verify**: no error mentions `@/`, `zod`, `http-status`, or a package removed in step 2.

## Test plan

No new test files — verification is build + pack + declaration greps + the existing suite. The critical regression risks are covered by: full test run (step 5) and the packed-artifact import (step 6).

## Done criteria

- [ ] `zod`, `http-status`, `@better-auth/core` declared (per step 1's placement)
- [ ] 5 unused runtime deps + 2 polar devDeps removed
- [ ] No `module` field; root export is a conditions object with `types` first
- [ ] `grep -rln 'from "@/' packages/payload-auth/dist --include="*.d.ts" | wc -l` → 0 after a fresh build
- [ ] Peer floors: `better-auth >=1.5.0`, `payload >=3.79.1` (and @payloadcms/* to match)
- [ ] `pnpm build` and `pnpm test:run` exit 0
- [ ] `pnpm-lock.yaml` committed in sync (`pnpm install --frozen-lockfile` passes afterwards)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any "unused" package turns out to have imports at execution time (re-verification grep in step 2 finds hits).
- `tsc-alias` fails or leaves residual `@/` specifiers after two attempts — report; do not switch to a different rewrite strategy unilaterally.
- Bumping to 3.79.x patch breaks the build or tests (report the breakage; do not upgrade past 3.79.x).
- The demo build (`pnpm --filter demo build`) was passing before your change and fails after (note: demo pins `@payloadcms/*` 3.67.0 and may not build even at baseline — establish the baseline first and only compare like-for-like).
- `better-auth`'s own zod range can't be determined — report rather than guessing a range.

## Maintenance notes

- Follow-ups deferred: remove `shamefully-hoist=true` from `.npmrc` (will surface any remaining phantom deps loudly); align `demo/` to the package's `@payloadcms/*` version (currently 3.67.0 vs 3.79.x, with a critical drizzle SQLi advisory at 3.67); consider a CI step that greps `dist/**/*.d.ts` for `@/` on every build (add to plan-002's workflow).
- Reviewer: check the peer-floor bump ships as a **minor** release with a release note (it will produce install warnings for consumers on older Payload versions — that is the point).
- When Better Auth 1.6.x is adopted (fixes OAuth refresh-token replay), revisit both the devDep pin and the floor.
