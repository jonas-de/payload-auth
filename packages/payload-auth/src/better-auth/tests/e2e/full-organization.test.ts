import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupAll, createAuthenticatedUser, getTestPayload } from "../helpers";
import { payloadAdapter } from "../../adapter/index";
import type { DBAdapter } from "@better-auth/core/db/adapter";

/**
 * Regression / closure evidence for issue #124: `getFullOrganization`
 * (BA's `adapter.findFullOrganization`) requests reverse joins for
 * `member` and `invitation` (and, when teams are enabled, `team`) on the
 * `organization` model in a single `findOne` call. This previously crashed
 * because of join-resolution bugs in the payload adapter.
 *
 * The test config (src/better-auth/tests/dev/index.ts) has
 * `organization({ teams: { enabled: true } })`, so `includeTeams` is always
 * true for `getFullOrganization` here — the collection's join fields
 * (see build-collections/organizations.ts) only include `member`,
 * `invitation`, and `organizationRole`, with no `team` join field. This test
 * asserts the call doesn't throw with teams enabled; if it does, that's the
 * residual gap to report, not to fix here.
 *
 * The invitation row is seeded directly through the adapter rather than via
 * `auth.api.createInvitation` — that endpoint's permission check
 * (`hasPermission`) independently fails in this test config because of a
 * pre-existing, unrelated bug in the adapter's role-field transform
 * (`transform/index.ts`): any field named `role`/`roles` is unconditionally
 * split into an array on input for every model, but `member`/`invitation`
 * roles are plain BA `z.string()` fields, so the array round-trips back out
 * as a literal `'["owner"]'` string instead of `"owner"`, and
 * `hasPermissionFn`'s `role.split(",")` never matches a valid role. This is
 * unrelated to #124 (join resolution) and to the BA 1.6 upgrade — it's not
 * fixed here; seeding via the adapter sidesteps it so this test stays
 * focused on join resolution.
 */
describe("Full organization resolution (#124)", () => {
  let payload: Awaited<ReturnType<typeof getTestPayload>>;
  let adapter: DBAdapter;

  beforeAll(async () => {
    payload = await getTestPayload();

    const adapterFactory = payloadAdapter({
      payloadClient: payload,
      adapterConfig: { idType: "number" }
    });
    adapter = adapterFactory({ ...payload.betterAuth.options });
  });

  afterAll(async () => {
    // Creating an organization with teams enabled auto-creates a default
    // team (and a team-member row for the creator). Both FK-reference
    // organizations/users, so they must be deleted before cleanupAll() (which
    // deletes users) and before the organizations delete below — otherwise
    // those deletes fail on a FK constraint. Payload's bulk `delete` with a
    // `where` clause swallows per-document errors instead of throwing, so an
    // FK failure here silently leaves rows behind rather than failing the
    // test, corrupting the shared scratch DB for later runs.
    await payload.delete({
      collection: "teamMembers",
      where: { id: { exists: true } }
    });
    await payload.delete({
      collection: "teams",
      where: { id: { exists: true } }
    });
    await cleanupAll(payload);
    await payload.delete({
      collection: "organizations",
      where: { id: { exists: true } }
    });
    await payload.delete({
      collection: "members",
      where: { id: { exists: true } }
    });
    await payload.delete({
      collection: "invitations",
      where: { id: { exists: true } }
    });
  });

  it("returns members and invitations arrays without throwing (teams enabled)", async () => {
    const { user, cookies } = await createAuthenticatedUser(payload, {
      email: "full-org-owner@test.com",
      name: "Full Org Owner"
    });
    const headers = new Headers({ cookie: cookies.join("; ") });

    const org = await payload.betterAuth.api.createOrganization({
      body: { name: "Full Org Test", slug: `full-org-test-${Date.now()}` },
      headers
    });
    expect(org).toBeDefined();
    expect(org?.id).toBeDefined();

    // Sanity check: createOrganization auto-adds the creator as a member.
    const memberDocs = await payload.find({
      collection: "members",
      where: { organization: { equals: org!.id } }
    });
    expect(memberDocs.docs.length).toBe(1);

    // Seed the invitation directly via the adapter (see file header for why
    // we don't go through auth.api.createInvitation here).
    await adapter.create<Record<string, any>>({
      model: "invitation",
      data: {
        organizationId: String(org!.id),
        email: "full-org-invitee@test.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
        inviterId: String(user.id)
      }
    });

    let full: any;
    let thrownError: unknown = null;
    try {
      full = await payload.betterAuth.api.getFullOrganization({
        query: { organizationId: org!.id },
        headers
      });
    } catch (error) {
      thrownError = error;
    }

    if (thrownError) {
      // Residual gap: no `team` join field exists on the organizations
      // collection (see build-collections/organizations.ts), and teams
      // are enabled in this test config. Report the stack rather than
      // fixing it here — out of scope for this plan.
      throw new Error(
        `getFullOrganization threw with teams enabled — residual #124 gap:\n${
          thrownError instanceof Error ? thrownError.stack : String(thrownError)
        }`
      );
    }

    expect(full).toBeDefined();
    expect(Array.isArray(full.members)).toBe(true);
    expect(full.members.length).toBeGreaterThan(0);
    expect(full.members[0].user).toBeDefined();
    expect(full.members[0].user.id).toBe(String(user.id));

    expect(Array.isArray(full.invitations)).toBe(true);
    expect(full.invitations.length).toBeGreaterThan(0);
    expect(full.invitations[0].email).toBe("full-org-invitee@test.com");
  });
});
