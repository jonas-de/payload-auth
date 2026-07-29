import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TestHelpers } from "better-auth/plugins";
import { cleanupAll, createQuickSession, getTestContext } from "../helpers";
import type { BasePayload } from "payload";

/**
 * Regression tests for #112: creating an organization via the Better Auth API
 * writes the auto-created "owner" member row through the adapter. member.role
 * is a plain text field (BA's comma-separated string), NOT a hasMany select
 * like users.role — the adapter must not force it into an array.
 *
 * Also covers invitations, whose role field is the same plain-text shape.
 */
describe("Organization role handling (#112)", () => {
  let payload: BasePayload;
  let test: TestHelpers;

  beforeAll(async () => {
    ({ payload, test } = await getTestContext());
  });

  afterEach(async () => {
    // Delete organization-plugin collections first — members/invitations/teams
    // reference users/organizations, so they must go before cleanupAll deletes users.
    for (const slug of ["invitations", "members", "teamMembers", "teams", "organizations"] as const) {
      try {
        await payload.delete({ collection: slug as any, where: { id: { exists: true } } });
      } catch {
        // collection may not exist
      }
    }
    await cleanupAll(payload);
  });

  it("creates an organization with no collectionOverrides hook and the owner member role is the string 'owner'", async () => {
    const { user, headers } = await createQuickSession(test, {
      email: "org-owner@test.com"
    });

    const org = await payload.betterAuth.api.createOrganization({
      body: {
        name: "Test Org",
        slug: `test-org-${Date.now()}`,
        userId: user.id
      },
      headers
    });

    expect(org).toBeDefined();
    expect(org!.id).toBeDefined();

    const members = await payload.find({
      collection: "members" as any,
      where: { organization: { equals: org!.id } }
    });

    expect(members.docs.length).toBeGreaterThan(0);
    const ownerMember = members.docs.find((m: any) => String(m.user) === String(user.id) || String(m.user?.id) === String(user.id));
    expect(ownerMember).toBeDefined();
    expect(typeof ownerMember!.role).toBe("string");
    expect(ownerMember!.role).toBe("owner");
  });

  it("invitation role round-trips as a string", async () => {
    const { user, headers } = await createQuickSession(test, {
      email: "org-inviter@test.com"
    });

    const org = await payload.betterAuth.api.createOrganization({
      body: {
        name: "Invite Org",
        slug: `invite-org-${Date.now()}`,
        userId: user.id
      },
      headers
    });

    expect(org).toBeDefined();

    const invitation = await payload.betterAuth.api.createInvitation({
      body: {
        organizationId: org!.id,
        email: "invitee@test.com",
        role: "admin"
      },
      headers
    });

    expect(invitation).toBeDefined();
    expect(typeof (invitation as any).role).toBe("string");
    expect((invitation as any).role).toBe("admin");

    const invitationDoc = await payload.findByID({
      collection: "invitations" as any,
      id: (invitation as any).id
    });

    expect(typeof invitationDoc.role).toBe("string");
    expect(invitationDoc.role).toBe("admin");
  });
});
