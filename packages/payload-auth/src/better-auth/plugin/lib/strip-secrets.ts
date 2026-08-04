import type { PayloadAuthOptions } from "../types";

/**
 * Key names that, wherever they appear inside a Better Auth plugin's config
 * (e.g. `plugin.options`), are treated as secret-bearing and nulled out
 * before the surrounding object is passed to the admin client as
 * `serverProps`. `clientId` intentionally does not match this pattern.
 */
const SECRET_KEY_PATTERN = /secret|token|apikey|privatekey|password/i;

/** Bound on recursion depth when scanning plugin configs, as a defensive
 * guard against unexpectedly deep or self-referential structures. */
const MAX_SCAN_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively walks plain objects/arrays and nulls the value of any own key
 * whose name matches {@link SECRET_KEY_PATTERN}. Non-plain values (class
 * instances, functions, Dates, etc.) are returned as-is without recursing
 * into them, since Better Auth plugin objects carry functions (endpoints,
 * hooks) alongside their plain-data `options`.
 */
function stripSecretKeysDeep<T>(value: T, depth = 0): T {
  if (depth >= MAX_SCAN_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map((item) => stripSecretKeysDeep(item, depth + 1)) as T;
  }

  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key)
      ? null
      : stripSecretKeysDeep(val, depth + 1);
  }
  return result as T;
}

/**
 * Returns a shallow clone of `pluginOptions` with secret values removed:
 *
 *  - `betterAuthOptions.secret`
 *  - `betterAuthOptions.socialProviders[*].clientSecret`
 *  - any key matching {@link SECRET_KEY_PATTERN} nested anywhere inside a
 *    `betterAuthOptions.plugins[*]` entry (e.g. a plugin's `options.apiKey`)
 *
 * This is intended for values that will be passed as `serverProps` to admin
 * view components. Payload serializes view `serverProps` into the admin
 * client config, which ends up in the RSC payload of the HTML response, so
 * anything in `serverProps` is visible to anyone who can load the login page.
 *
 * `clientId` is preserved — it is public by design and needed to render the
 * "Sign in with <provider>" button. Admin views only ever read
 * `betterAuthOptions.plugins[*].id` (to check whether a plugin is enabled)
 * and the two-factor plugin's `options.totpOptions.digits`, neither of which
 * this strips.
 */
export function stripSecretsFromPluginOptions(
  pluginOptions: PayloadAuthOptions
): PayloadAuthOptions {
  const clone: PayloadAuthOptions = { ...pluginOptions };
  if (!clone.betterAuthOptions) return clone;

  const ba = { ...clone.betterAuthOptions };
  delete (ba as Record<string, unknown>).secret;

  if (ba.socialProviders) {
    ba.socialProviders = Object.fromEntries(
      Object.entries(ba.socialProviders).map(([provider, cfg]) => {
        if (!cfg || typeof cfg !== "object") return [provider, cfg];
        const { clientSecret: _cs, ...rest } = cfg as Record<string, unknown>;
        return [provider, rest];
      })
    ) as typeof ba.socialProviders;
  }

  if (Array.isArray(ba.plugins)) {
    ba.plugins = ba.plugins.map((plugin) => {
      if (!plugin || typeof plugin !== "object") return plugin;
      const pluginClone: Record<string, unknown> = { ...plugin };
      for (const [key, val] of Object.entries(pluginClone)) {
        // `id` is required for `checkPluginExists` and must survive as-is;
        // everything else is scanned recursively for secret-shaped keys.
        if (key === "id") continue;
        pluginClone[key] = stripSecretKeysDeep(val);
      }
      return pluginClone;
    }) as typeof ba.plugins;
  }

  clone.betterAuthOptions = ba;
  return clone;
}
