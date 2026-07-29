import { describe, expect, it } from "vitest";
import { generateVerifyEmailUrl } from "../../plugin/helpers/generate-verify-email-url";

/**
 * Unit tests for generateVerifyEmailUrl's callback URL validation (NEW-1).
 *
 * The verification email embeds `callbackURL` directly in a link sent from a
 * trusted address. An unvalidated value is an open-redirect / phishing
 * vector, so the value must be routed through getSafeRedirect: unsafe values
 * are dropped from the URL entirely rather than degraded to a fallback path.
 *
 * Pure function — no DB required.
 */
describe("generateVerifyEmailUrl callback URL validation", () => {
  const baseArgs = {
    userEmail: "user@example.com",
    secret: "test-secret",
    verifyRouteUrl: "https://app.example.com/api/auth/verify-email"
  };

  it("omits callbackURL when it is an absolute external URL", async () => {
    const url = await generateVerifyEmailUrl({
      ...baseArgs,
      callbackURL: "https://evil.com"
    });
    expect(url).not.toContain("callbackURL");
  });

  it("omits callbackURL when it is a protocol-relative URL", async () => {
    const url = await generateVerifyEmailUrl({
      ...baseArgs,
      callbackURL: "//evil.com"
    });
    expect(url).not.toContain("callbackURL");
  });

  it("keeps callbackURL when it is a safe relative path", async () => {
    const url = await generateVerifyEmailUrl({
      ...baseArgs,
      callbackURL: "/admin"
    });
    expect(url).toContain(`callbackURL=${encodeURIComponent("/admin")}`);
  });

  it("keeps the default root callbackURL when none is provided", async () => {
    const url = await generateVerifyEmailUrl(baseArgs);
    expect(url).toContain(`callbackURL=${encodeURIComponent("/")}`);
  });

  it("omits callbackURL for a javascript: scheme disguised as a path", async () => {
    const url = await generateVerifyEmailUrl({
      ...baseArgs,
      callbackURL: "/javascript:alert(1)"
    });
    expect(url).not.toContain("callbackURL");
  });

  it("always includes the token query parameter", async () => {
    const url = await generateVerifyEmailUrl({
      ...baseArgs,
      callbackURL: "https://evil.com"
    });
    expect(url).toContain("token=");
  });
});
