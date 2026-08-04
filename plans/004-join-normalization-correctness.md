# Plan 004: Fix join/relationship normalization in the adapter transform layer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90411f2..HEAD -- packages/payload-auth/src/better-auth/adapter/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (hot path for every auth DB operation; sign-in uses joins)
- **Depends on**: plans/001-portable-test-infra.md (tests must be runnable)
- **Category**: bug
- **Planned at**: commit `90411f2`, 2026-07-29

## Why this matters

The join-resolution area of the Better Auth ⇄ Payload adapter produced five consecutive bug-fix commits (`7776b4d`, `874404c`, `9b8feb7`, `4d58691`, `e19a07d`). Reading the current code shows four remaining defects in the same area:

1. **ID overwrite (ADAPTER-01)**: for relationship fields whose Payload name equals the Better Auth key (e.g. `teamMember.userId`, `organizationRole.organizationId`, `session.impersonatedBy`), the transform writes the BA-required string ID and then immediately overwrites it with the raw value (a JS number under `idType: "number"`). Better Auth identity comparisons (`member.userId === session.user.id`) then fail silently — `5 !== "5"`.
2. **Untransformed forward joins (ADAPTER-02)**: reverse-joined docs are recursively run through `transformOutput` (that was fix `e19a07d`), but forward-joined docs are assigned raw — dates stay ISO strings, nested relationship IDs stay numeric, renamed fields stay Payload-named. The `account → user` join used during sign-in is a forward join.
3. **Ambiguous field selection (ADAPTER-05)**: forward-join field lookup picks the *first* relationship field targeting the joined collection. `sessions` has two user-targeting fields (`user`, `impersonatedBy`) — the correct pick is currently luck of field order.
4. **Swallowed join failures (ADAPTER-06)**: forward-join lookup errors go to `debugLog` (a no-op unless `enableDebugLogs`), producing undiagnosable "user is null" failures in production.

## Current state

All in `packages/payload-auth/src/better-auth/adapter/`. Excerpts verified at `90411f2`.

### `transform/index.ts` — `normalizeDocumentIds` (~lines 653–683)

```ts
function normalizeDocumentIds(
  result: Record<string, any>,
  originalKey: string,   // BA field key, e.g. "userId"
  fieldName: string,     // Payload field name, e.g. "user" — MAY EQUAL originalKey
  value: any
): void {
  // Case 1: Primitive ID value (string or number)
  if (typeof value === "string" || typeof value === "number") {
    result[originalKey] = String(value);   // BA: string ID
    result[fieldName] = value;             // ← overwrites the line above when fieldName === originalKey
    return;
  }
  // Case 2: Object with ID property
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value) {
    result[originalKey] = String(value.id);
    result[fieldName] = { ...value, id: String(value.id) };  // ← same collision
    return;
  }
  // Case 3: arrays — same dual-write pattern follows
```

The call site (~line 591): `normalizeDocumentIds(result, originalRelatedFieldKey, key, value)` where `key === relationshipFields[k].fieldName || k` — so `originalKey === fieldName` exactly when the schema has no rename.

### Which fields are unrenamed

`packages/payload-auth/src/better-auth/plugin/constants.ts` — `baModelFieldKeysToFieldNames` (~lines 125–169) renames `account.userId→user`, `session.userId→user`, `member.*`, `invitation.*`, `team.organizationId→organization`, `twoFactor/passkey/ssoProvider/oauthApplication/oauthAccessToken/oauthConsent userId→user`, `oauthAccessToken/oauthConsent clientId→client`. It has **no entries** for `teamMember` or `organizationRole`, and no entry for `session.impersonatedBy` — those relationship fields keep BA key === Payload name.

### `index.ts` — `populateForwardJoins` (~lines 215–274)

```ts
const allFields = flattenAllFields({ fields: collection.config.fields }); // per-doc, no cache

for (const [joinModelKey, joinConfig] of Object.entries(join)) {
  ...
  const relField = allFields.find((f) => {          // ← FIRST match by relationTo only
    if (f.type !== "relationship" && f.type !== "upload") return false;
    if (!("relationTo" in f)) return false;
    if (Array.isArray(f.relationTo)) return f.relationTo.includes(joinSlug);
    return f.relationTo === joinSlug;
  });
  ...
  try {
    const relDoc = await payload.findByID({ collection: joinSlug as CollectionSlug, id: relId, depth: 0, ... });
    if (relDoc) {
      doc[relField.name] = relDoc;                  // ← raw, never transformOutput'ed
    }
  } catch (error) {
    debugLog([`forward join lookup failed for '${joinModelKey}' on ${collectionSlug}:`, error]);  // ← silent
  }
}
```

`debugLog` no-ops unless `adapterConfig.enableDebugLogs` (see ~line 42). An `errorLog` helper exists (~line 52) and is used elsewhere.

### The reverse-join path (the pattern to match) — `transform/index.ts` (~lines 556–582)

```ts
if (isJoinResult(value)) {
  const flatDocs = flattenJoinResult(value);
  const parentCollectionSlug = getCollectionSlug(model);
  const parentCollection = payload.collections[parentCollectionSlug];
  if (parentCollection) {
    const joinField = flattenAllFields({ fields: parentCollection.config.fields })
      .find((f: any) => f.type === "join" && f.name === key);
    if (joinField && "collection" in joinField) {
      const joinedModelKey = resolveModelKey(joinField.collection as string);
      result[targetFieldKey] = flatDocs.map((d: any) =>
        transformOutput({ doc: d, model: joinedModelKey, payload })
      );
      return;
    }
  }
```

`resolveModelKey(collectionSlug)` (transform/index.ts ~line 73) maps a collection slug back to a BA model key — reuse it.

### Existing tests

`packages/payload-auth/src/better-auth/tests/e2e/join-resolution.test.ts` — asserts (a) `session` findOne with `join: { user: true }` returns `found.user` as an object (reverse-ish naming; session's `user` field is a renamed forward relationship — the object lands on the Payload key `user` while `userId` stays a string) and (b) a no-join query returns flat scalar IDs. `tests/adapter/transform.test.ts` holds the transform unit tests (35 cases; pattern to extend).

### The data-shape contract (must be preserved)

`dev-docs/ARCHITECTURE.md` ("Data Contract Guarantee") and the P1-13 fix history establish: Better Auth must always receive **string scalar IDs** under BA field keys. Joined documents are an additive extra under the *Payload* field name when it differs from the BA key. This plan makes that contract hold in the collision case: **when Payload name === BA key, the string ID wins**; a populated object must never replace the ID under a BA field key.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test DB up | `docker compose -f docker-compose.test.yml up -d` | healthy |
| Migrate | `cd packages/payload-auth && pnpm test:payload migrate` | exit 0 |
| Transform unit tests | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/adapter/transform.test.ts` | pass |
| Join e2e tests | `cd packages/payload-auth && pnpm test:run src/better-auth/tests/e2e/join-resolution.test.ts` | pass |
| Full suite | `cd packages/payload-auth && pnpm test:run` | pass |
| Build | `cd packages/payload-auth && pnpm build` | exit 0 |

## Scope

**In scope**:
- `packages/payload-auth/src/better-auth/adapter/transform/index.ts` (`normalizeDocumentIds` only)
- `packages/payload-auth/src/better-auth/adapter/index.ts` (`populateForwardJoins` and its callers only)
- `packages/payload-auth/src/better-auth/tests/adapter/transform.test.ts` (extend)
- `packages/payload-auth/src/better-auth/tests/e2e/join-resolution.test.ts` (extend)

**Out of scope**:
- The `depth: hasReverseJoins ? 1 : PAYLOAD_QUERY_DEPTH` escalation (recorded separately as a backlog item — it needs a design decision about collapsing non-requested relationships and an ARCHITECTURE.md update; do not change depth handling here).
- Batching the per-doc forward-join queries (perf backlog item ADAPTER-03) — keep the loop; you may hoist `flattenAllFields` out of the per-doc loop if trivial, but no batching redesign.
- `flattenJoinResult`, `convertWhereClause`, and all other transform functions.
- `plugin/` — nothing outside the adapter directory.

## Git workflow

- Branch: `advisor/004-join-normalization`
- One conventional commit per step, e.g. `fix: string ID must win when BA key equals payload field name`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the string ID win on key collision (`normalizeDocumentIds`)

In all three cases of `normalizeDocumentIds`, write the Payload-shaped value first and the BA string ID last, so the BA contract wins when the keys collide:

```ts
// Case 1
if (typeof value === "string" || typeof value === "number") {
  if (fieldName !== originalKey) result[fieldName] = value;
  result[originalKey] = String(value);
  return;
}
// Case 2
... {
  if (fieldName !== originalKey) result[fieldName] = { ...value, id: String(value.id) };
  result[originalKey] = String(value.id);
  return;
}
// Case 3 (arrays): same pattern — BA key gets the string-ID array; Payload key
// only written when the names differ.
```

**Verify**: `pnpm test:run src/better-auth/tests/adapter/transform.test.ts` → existing tests pass (if any existing test asserts the old collision behavior — a raw number/object under a BA key — STOP: that would mean something depends on it).

### Step 2: Unit-test the collision fix

Add cases to `transform.test.ts` (model on the existing relationship-normalization tests):

- unrenamed relationship + numeric ID → output has `userId: "5"` (string), and no numeric leak;
- renamed relationship + numeric ID → `userId: "5"` AND `user: 5` both present;
- unrenamed relationship + populated object → `userId: "5"` (string, not object);
- renamed relationship + populated object → `userId: "5"` AND `user: { id: "5", ... }`.

Use a model that actually has an unrenamed relationship (`teamMember` or `organizationRole` — check the test file's existing schema fixtures for how models are set up).

**Verify**: the 4 new tests pass.

### Step 3: Transform forward-joined documents (`populateForwardJoins`)

Where the raw doc is assigned (`doc[relField.name] = relDoc`), transform it first, mirroring the reverse-join branch. `populateForwardJoins` lives inside the adapter factory where the transform functions are in scope (check what `adapter/index.ts` already imports/destructures from `createTransform` — `transformOutput` is used by every CRUD method in this file; reuse the same reference):

```ts
const transformed = transformOutput({ doc: relDoc, model: joinModelKey as ModelKey, payload });
if (fieldNameForJoin !== <BA key of relField>) {
  doc[relField.name] = transformed;
}
```

Practical shape: assign `doc[relField.name] = transformed` as today, **but** note that after step 1, when `relField.name` equals the BA key, `transformOutput` on the parent will collapse it back to a string ID (string wins). That is the intended contract; for unrenamed fields the joined object is intentionally not exposed (log a debug note). Do not invent a new key for it.

Order of operations matters: check the call sites (`findOne`/`findMany` around lines 396–549) — `populateForwardJoins` currently runs **before** `transformOutput` on the parent doc. Keep that order; the parent transform will then normalize the joined object via `normalizeDocumentIds` Case 2 (renamed case: object preserved under the Payload key, string ID under the BA key).

Given that, the minimal correct change is: transform the joined doc with `transformOutput` for the **joined** model before assignment, so its own dates/IDs/renames are normalized; the parent transform then handles placement:

```ts
if (relDoc) {
  doc[relField.name] = transformOutput({ doc: relDoc, model: joinModelKey as ModelKey, payload });
}
```

**Verify**: `pnpm test:run src/better-auth/tests/e2e/join-resolution.test.ts` → passes.

### Step 4: e2e-test forward-join shapes

Extend `join-resolution.test.ts`: for a `session` fetched with `join: { user: true }`, assert on the joined user object:

- `found.user.createdAt instanceof Date` (dates transformed);
- `typeof found.user.id === "string"` (IDs stringified);
- `typeof found.userId === "string"` (parent BA key still a flat string).

**Verify**: new assertions pass.

### Step 5: Disambiguate the forward-join field pick

In `populateForwardJoins`, before the `relField` `find`, resolve the expected Payload field name from the parent model's schema: the schema (available in the adapter factory — see how `createTransform` receives it, and what `getSchemaFieldName`-style helpers exist in `transform/index.ts` / `plugin/helpers/`) maps the parent model's field whose `references.model` is the joined model to its `fieldName`. Selection order:

1. If the parent model's BA schema has a field referencing the joined model, look up its Payload `fieldName` (fall back to the BA key when unrenamed) and pick `allFields.find(f => f.name === thatName)`.
2. Only if the schema lookup yields nothing, fall back to the current first-match-by-`relationTo` behavior.
3. If multiple schema fields reference the joined model, pick the first and emit a warning via `errorLog`.

**Verify**: add a unit or e2e test asserting that a `session` forward join for `user` populates the `user` field and NOT `impersonatedBy` (create a session row with both set; assert `impersonatedBy` remains a scalar ID).

### Step 6: Surface join failures

Replace the `debugLog` in the `catch` with `errorLog` (same argument shape as other `errorLog` call sites in the file), including `joinModelKey`, `collectionSlug`, and the relation ID. Keep the non-throwing behavior. Also promote the "no join field found" skip at ~line 189–194 from `debugLog` to `errorLog` **only** when the model was explicitly requested in the `join` option but neither a reverse join field nor a forward relationship field could be found (i.e. the join silently does nothing).

**Verify**: `grep -n "debugLog" packages/payload-auth/src/better-auth/adapter/index.ts` → the forward-join catch no longer uses it.

### Step 7: Full suite + build

**Verify**: `pnpm test:run` → all pass. `pnpm build` → exit 0.

## Test plan

Steps 2, 4, 5 define the new tests: 4 transform unit cases (collision matrix), 3 forward-join shape assertions, 1 disambiguation test. Pattern files: `tests/adapter/transform.test.ts` (unit), `tests/e2e/join-resolution.test.ts` (e2e).

## Done criteria

- [ ] In `normalizeDocumentIds`, the BA string ID is written last in all three cases (collision-safe)
- [ ] `populateForwardJoins` transforms joined docs via `transformOutput` before assignment
- [ ] Forward-join field selection is schema-driven with `relationTo` fallback
- [ ] Forward-join failures log via `errorLog`
- [ ] ≥8 new test cases pass; full `pnpm test:run` exits 0
- [ ] `pnpm build` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt doesn't match — this file had 5 hotfixes in 4 months; drift is likely and must be re-audited, not adapted around.
- An existing test asserts a populated object under a BA field key for an *unrenamed* field (would mean Better Auth actually consumes the object there; the contract assumption is then wrong — report, don't pick a side).
- Step 5's schema lookup can't be done without threading new parameters through more than two function signatures — report the required refactor instead of doing it.
- Sign-in e2e tests (`tests/e2e/email-password.test.ts`, `tests/e2e/social-login.test.ts`) regress at any step.

## Maintenance notes

- Deferred, recorded in the backlog: depth-1 escalation on reverse joins (contradicts the documented depth-0 contract; needs a collapse-non-requested-relationships design + ARCHITECTURE.md update), and batching forward joins (`in`-query per joined collection instead of per-doc `findByID`).
- Reviewer scrutiny: step 1 changes the shape returned for *renamed* populated fields only in write-order, not content — diff a before/after `transformOutput` result for a session doc to confirm.
- Any future collection builder that adds a second relationship to the same target collection must rely on step 5's schema-driven selection — never on field order.
