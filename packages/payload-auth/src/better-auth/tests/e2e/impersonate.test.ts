import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TestHelpers } from "better-auth/plugins";
import { cleanupAll, createQuickSession, createQuickUser, getTestContext } from "../helpers";
import type { BasePayload } from "payload";

/**
 * Regression test for #128: Better Auth's admin plugin impersonateUser route
 * does `(targetUser.role || opts.defaultRole || "user").split(",")`. If the
 * adapter hands it an array (from users.role being a hasMany select), this
 * throws a TypeError. The adapter must always hand BetterAuth a string role
 * for user documents.
 */
describe("Admin impersonation role handling (#128)", () => {
  let payload: BasePayload;
  let test: TestHelpers;

  beforeAll(async () => {
    ({ payload, test } = await getTestContext());
  });

  afterEach(async () => {
    await cleanupAll(payload);
  });

  it("impersonateUser does not throw a TypeError on target user role", async () => {
    // Admin user (role must include "admin" per betterAuthPluginOptions.users.adminRoles)
    const { user: adminUser, headers: adminHeaders } = await createQuickSession(test, {
      email: "impersonate-admin@test.com"
    });
    await payload.update({
      collection: "users",
      id: adminUser.id,
      data: { role: ["admin"] }
    });
    // Re-login so the session cookie cache reflects the new role
    const { headers: freshAdminHeaders } = await test.login({ userId: adminUser.id });

    // Target user to impersonate
    const targetUser = await createQuickUser(test, {
      email: "impersonate-target@test.com"
    });

    let thrown: unknown = null;
    let result: Awaited<ReturnType<typeof payload.betterAuth.api.impersonateUser>> | undefined;
    try {
      result = await payload.betterAuth.api.impersonateUser({
        body: { userId: targetUser.id },
        headers: freshAdminHeaders
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
    expect(result).toBeDefined();
    expect(result!.session).toBeDefined();
    expect(String(result!.session.impersonatedBy)).toBe(String(adminUser.id));
  });
});
