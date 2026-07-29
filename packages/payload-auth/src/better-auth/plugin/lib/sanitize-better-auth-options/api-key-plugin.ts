import { baModelKey } from "@/better-auth/plugin/constants";
import type { BetterAuthSchemas } from "@/better-auth/types";
import { set } from "../../utils/set";
import {
  getSchemaCollectionSlug,
  getSchemaFieldName
} from "../build-collections/utils/collection-schema";

export function configureApiKeyPlugin(
  plugin: any,
  resolvedSchemas: BetterAuthSchemas
): void {
  const model = baModelKey.apikey;
  set(
    plugin,
    `schema.${model}.modelName`,
    getSchemaCollectionSlug(resolvedSchemas, model)
  );
  // The api-key plugin's schema field is `referenceId` (it can reference a
  // user or, with `references: "organization"`, an organization). This repo
  // defaults it to referencing the user collection — restore the FK wiring
  // that was dropped in the BA v1.5 upgrade so custom user collection slugs
  // resolve correctly (P2-12 regression).
  set(
    plugin,
    `schema.${model}.fields.referenceId.fieldName`,
    getSchemaFieldName(resolvedSchemas, model, "referenceId")
  );
  set(
    plugin,
    `schema.${model}.fields.referenceId.references.model`,
    getSchemaCollectionSlug(resolvedSchemas, baModelKey.user)
  );
}
