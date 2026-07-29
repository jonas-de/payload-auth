import { describe, expect, it } from "vitest";
import { otpField } from "../../../shared/form/validation";

describe("otpField", () => {
  it("accepts a 6-digit numeric code by default", () => {
    const result = otpField().safeParse("123456");
    expect(result.success).toBe(true);
  });

  it("rejects a code with fewer than 6 digits", () => {
    const result = otpField().safeParse("12345");
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric code", () => {
    const result = otpField().safeParse("abcdef");
    expect(result.success).toBe(false);
  });

  it("accepts an 8-digit numeric code when digits is configured", () => {
    const result = otpField({ digits: 8 }).safeParse("12345678");
    expect(result.success).toBe(true);
  });

  it("rejects a 6-digit code when digits is configured to 8", () => {
    const result = otpField({ digits: 8 }).safeParse("123456");
    expect(result.success).toBe(false);
  });
});
