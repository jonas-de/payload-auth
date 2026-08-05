# Payload database adapter for Better Auth

Implements Better Auth's `DBAdapter` interface on top of Payload's Local API.

> **You usually do not construct this yourself.** `betterAuthPlugin` installs the adapter,
> generates the collections, and wires every `modelName` and field mapping for you. Reach
> for the adapter directly only when you want Better Auth backed by Payload storage
> *without* the plugin's generated collections and admin views.

Full reference: <https://payload-auth.dev/docs/reference/adapter>

## Usage

```ts
import { betterAuth } from 'better-auth'
import { payloadAdapter } from 'payload-auth/better-auth/adapter'
import type { BasePayload } from 'payload'

export function auth(payload: BasePayload) {
  return betterAuth({
    database: payloadAdapter({
      payloadClient: payload,
      adapterConfig: {
        idType: payload.db.defaultIDType,
        enableDebugLogs: false,
      },
    }),
    // ... your options
  })
}
```

Better Auth is constructed from a Payload instance, which is why this is a function rather
than a module-level constant.

### Options

| Option | Type | Description |
| --- | --- | --- |
| `payloadClient` | `BasePayload \| Promise<BasePayload> \| (() => Promise<BasePayload>)` | The Payload instance. A promise or thunk is allowed so it can resolve lazily; the result is cached. |
| `adapterConfig.idType` | `'number' \| 'text'` | How your database represents IDs. Use `payload.db.defaultIDType`. |
| `adapterConfig.enableDebugLogs` | `boolean` | Log every database call with inputs and outputs under the `[payload-db-adapter]` prefix. Defaults to `false`. |

## Mapping is your responsibility

Standalone, nothing rewrites model names or field names. Payload slugs are usually plural
while Better Auth models are singular, and foreign keys become relationships:

```ts
betterAuth({
  database: payloadAdapter({ payloadClient, adapterConfig: { idType: 'number' } }),
  user: { modelName: 'users' },
  session: { modelName: 'sessions', fields: { userId: 'user' } },
  account: { modelName: 'accounts', fields: { userId: 'user' } },
  verification: { modelName: 'verifications' },
})
```

A model that resolves to a slug Payload does not know throws
`BetterAuthError: Collection <model> does not exist`.

## What it translates

- **IDs** — Better Auth expects strings; Payload may use numbers. Converted in both
  directions using `idType`.
- **Field names** — configured `fields` mappings are applied on input and reversed on
  output.
- **Operators** — `eq` → `equals`, `ne` → `not_equals`, `gt` → `greater_than`,
  `starts_with` / `ends_with` → `like`, and so on.
- **Dates** — ISO strings from Payload become `Date` objects.
- **Depth** — every query runs at `depth: 0`, so relationships come back as raw IDs.

A `where` clause that is just `id equals X` is routed to `payload.findByID()` rather than
`payload.find()`.

## Schema generation

`generateSchema` writes Payload collection configs derived from your Better Auth options:

```ts
import { generateSchema } from 'payload-auth/better-auth/adapter'
import { betterAuthOptions } from './auth/options'

await generateSchema(betterAuthOptions, { outputDir: './src/payload/schema' })
```

It writes `schema.ts` into the output directory, merging with anything already there.

> Treat the output as a starting point. Review the access control and field configuration
> before shipping it.
