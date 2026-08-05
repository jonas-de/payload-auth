import { describe, expect, it } from "vitest";
import { baModelKey } from "../../plugin/constants";
import { configureApiKeyPlugin } from "../../plugin/lib/sanitize-better-auth-options/api-key-plugin";
import { BetterAuthSchemas } from "../../plugin/types";

// Helper to create a minimal resolved schemas object
function createMockResolvedSchemas(
  overrides: Partial<
    Record<
      string,
      { modelName: string; fields: Record<string, any>; order: number }
    >
  > = {}
): BetterAuthSchemas {
  const defaultSchemas: Record<string, any> = {
    [baModelKey.apikey]: {
      modelName: "apiKeys",
      fields: { referenceId: { fieldName: "referenceId" } },
      order: 0
    },
    [baModelKey.user]: {
      modelName: "users",
      fields: {},
      order: 1
    }
  };

  return { ...defaultSchemas, ...overrides } as unknown as BetterAuthSchemas;
}

// Helper to get nested property using lodash-style dot notation
function get(obj: any, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

describe("configureApiKeyPlugin", () => {
  it("sets the apikey model's modelName", () => {
    const plugin: any = {};
    const schemas = createMockResolvedSchemas();

    configureApiKeyPlugin(plugin, schemas);

    expect(get(plugin, `schema.${baModelKey.apikey}.modelName`)).toBe(
      "apiKeys"
    );
  });

  // P2-12 REGRESSION: the referenceId -> user FK wiring was dropped in the
  // BA v1.5 upgrade (the api-key plugin's schema field was renamed from
  // `userId` to `referenceId` at the same time).
  it("sets apikey.referenceId.references.model to the user collection", () => {
    const plugin: any = {};
    const schemas = createMockResolvedSchemas();

    configureApiKeyPlugin(plugin, schemas);

    const referenceModel = get(
      plugin,
      `schema.${baModelKey.apikey}.fields.referenceId.references.model`
    );
    expect(referenceModel).toBe("users");
  });

  it("resolves referenceId.references.model against a custom users collection slug", () => {
    const plugin: any = {};
    const schemas = createMockResolvedSchemas({
      [baModelKey.user]: {
        modelName: "my-users",
        fields: {},
        order: 1
      }
    });

    configureApiKeyPlugin(plugin, schemas);

    const referenceModel = get(
      plugin,
      `schema.${baModelKey.apikey}.fields.referenceId.references.model`
    );
    expect(referenceModel).toBe("my-users");
    expect(referenceModel).not.toBe("users");
  });

  it("resolves the apikey modelName against a custom api-keys collection slug", () => {
    const plugin: any = {};
    const schemas = createMockResolvedSchemas({
      [baModelKey.apikey]: {
        modelName: "my-api-keys",
        fields: { referenceId: { fieldName: "referenceId" } },
        order: 0
      }
    });

    configureApiKeyPlugin(plugin, schemas);

    expect(get(plugin, `schema.${baModelKey.apikey}.modelName`)).toBe(
      "my-api-keys"
    );
  });
});
