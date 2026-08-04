import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupAll, getTestContext } from "../helpers";

/**
 * Regression test for issue #160: on Better Auth >=1.6, verifying a phone
 * number OTP crashed with `txAdapter.consumeOne is not a function` because
 * the payload adapter didn't implement the (now required) `consumeOne`
 * DBAdapter method. `verifyPhoneNumber` consumes the OTP verification value
 * via `internalAdapter.consumeVerificationValue`, which calls
 * `adapter.consumeOne` under the hood.
 */
describe("Phone number OTP verification (#160)", () => {
  let ctx: Awaited<ReturnType<typeof getTestContext>>;

  const phoneNumber = "+15005550006";

  beforeAll(async () => {
    ctx = await getTestContext();
  });

  afterAll(async () => {
    await cleanupAll(ctx.payload);
  });

  it("sends an OTP, verifies it, and consumes the verification row", async () => {
    const { payload, test } = ctx;

    const signUp = await payload.betterAuth.api.signUpEmail({
      body: {
        email: "phone-otp@test.com",
        password: "Password123!",
        name: "Phone OTP User"
      }
    });
    expect(signUp.user).toBeDefined();

    // Attach an (unverified) phone number to the user before requesting an OTP.
    await payload.update({
      collection: "users",
      id: signUp.user.id,
      data: { phoneNumber }
    });

    const sendResult = await payload.betterAuth.api.sendPhoneNumberOTP({
      body: { phoneNumber }
    });
    expect(sendResult).toMatchObject({ message: "code sent" });

    const code = test.getOTP?.(phoneNumber);
    expect(code).toBeDefined();

    // This is the crash path from #160 — verifyPhoneNumber calls
    // internalAdapter.consumeVerificationValue -> adapter.consumeOne.
    const verifyResult = await payload.betterAuth.api.verifyPhoneNumber({
      body: { phoneNumber, code: code! }
    });

    expect(verifyResult.status).toBe(true);
    expect(verifyResult.user?.phoneNumberVerified).toBe(true);

    // The verification row for this identifier must be consumed (deleted).
    const remaining = await payload.find({
      collection: "verifications",
      where: { identifier: { equals: phoneNumber } }
    });
    expect(remaining.docs.length).toBe(0);
  });
});
