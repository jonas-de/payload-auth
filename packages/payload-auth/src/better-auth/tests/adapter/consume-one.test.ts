import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { payloadAdapter } from "../../adapter/index";
import { getPayload } from "../dev";

/**
 * Regression coverage for the payload adapter's `consumeOne` implementation
 * (Better Auth 1.6 requires it on the DBAdapter interface; see issue #160 —
 * `txAdapter.consumeOne is not a function`).
 *
 * `consumeOne` must atomically find-and-delete a single row matching `where`
 * and return it, returning `null` on a second call against the same `where`
 * once the row has already been consumed (the double-consume guard).
 */
describe("Adapter consumeOne", async () => {
  const payload = await getPayload();

  const adapter = payloadAdapter({
    payloadClient: payload,
    adapterConfig: { idType: "number" }
  })({ ...payload.betterAuth.options });

  const identifier = "consume-one-test-identifier";

  beforeAll(async () => {
    await payload.delete({
      collection: "verifications",
      where: { identifier: { equals: identifier } }
    });
  });

  afterAll(async () => {
    await payload.delete({
      collection: "verifications",
      where: { identifier: { equals: identifier } }
    });
  });

  it("returns the row on first call and null on a second call against the same where (double-consume guard)", async () => {
    const created = await adapter.create<Record<string, any>>({
      model: "verification",
      data: {
        identifier,
        value: "123456:0",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    expect(created).toBeDefined();
    expect(created.identifier).toBe(identifier);

    const where = [{ field: "identifier", value: identifier }];

    const first = await adapter.consumeOne<Record<string, any>>({
      model: "verification",
      where
    });

    expect(first).not.toBeNull();
    expect(first?.identifier).toBe(identifier);
    expect(first?.value).toBe("123456:0");

    const second = await adapter.consumeOne<Record<string, any>>({
      model: "verification",
      where
    });

    expect(second).toBeNull();

    // The row should actually be gone from the underlying collection.
    const remaining = await adapter.findMany({
      model: "verification",
      where
    });
    expect(remaining.length).toBe(0);
  });

  it("returns null when no row matches the where clause", async () => {
    const result = await adapter.consumeOne({
      model: "verification",
      where: [{ field: "identifier", value: "no-such-identifier" }]
    });

    expect(result).toBeNull();
  });
});
