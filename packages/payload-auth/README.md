# payload-auth

Better Auth for [Payload CMS](https://payloadcms.com). One auth system for your admin panel and your app.

`payload-auth` replaces Payload's built-in authentication with [Better Auth](https://www.better-auth.com). The Payload admin panel and your frontend share the same session, so a user who signs in with Google on your marketing site is the same user Payload sees in the admin panel — no second user table, no bridging code.

📖 **[Documentation](https://payload-auth.dev)** · 🤖 **[llms.txt](https://payload-auth.dev/llms.txt)**

## Install

```bash
pnpm add payload-auth better-auth
```

## Use

```ts
// src/payload.config.ts
import { buildConfig } from 'payload'
import { betterAuthPlugin } from 'payload-auth/better-auth'

export default buildConfig({
  admin: { user: 'users' },
  plugins: [
    betterAuthPlugin({
      users: {
        roles: ['user', 'admin'],
        adminRoles: ['admin'],
      },
      betterAuthOptions: {
        emailAndPassword: { enabled: true },
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        },
      },
    }),
  ],
})
```

```ts
// src/app/api/auth/[...all]/route.ts
import configPromise from '@payload-config'
import { toNextJsHandler } from 'better-auth/next-js'
import { getPayloadAuth } from 'payload-auth/better-auth'

const payload = await getPayloadAuth(configPromise)

export const { POST, GET } = toNextJsHandler(payload.betterAuth)
```

Then regenerate the import map and create the schema:

```bash
pnpm payload generate:importmap
pnpm payload migrate:create && pnpm payload migrate
```

See the [installation guide](https://payload-auth.dev/docs/getting-started/installation) for the full walkthrough.

## What it does

- **Generates collections.** `users`, `sessions`, `accounts` and `verifications` are built from the Better Auth schema, plus one collection for every Better Auth plugin you enable — passkeys, two-factors, organizations, API keys, SSO providers and more.
- **Leaves Better Auth alone.** The plugin installs a database adapter that speaks Payload's Local API. Every Better Auth endpoint, plugin and client method behaves exactly as its own docs describe.
- **Replaces the admin auth views.** Login, signup, forgot password, reset password and two-factor verification are rendered by Better Auth-powered views that respect your enabled login methods.
- **Wires up roles.** Define roles once; they feed Payload access control and the Better Auth `admin` plugin.

## Entry points

| Import path | Contents |
| --- | --- |
| `payload-auth/better-auth` | Plugin, adapter and types — the usual import |
| `payload-auth/better-auth/plugin` | Plugin only |
| `payload-auth/better-auth/adapter` | Adapter only |
| `payload-auth/better-auth/plugin/client` | Client components |
| `payload-auth/better-auth/plugin/rsc` | Server components and admin views |
| `payload-auth/shared/payload/fields` | Reusable Payload field components |

## Requirements

| Requirement | Version |
| --- | --- |
| `payload`, `@payloadcms/next`, `@payloadcms/ui` | `>=3.79.1 <4` |
| `better-auth`, `@better-auth/core` | `>=1.5.0 <2` |
| `next` | `>=15.4.8 <17` |
| `react`, `react-dom` | `>=19.2.1 <20` |
| `zod` | `^4.3.6` |

Any Payload database adapter works — the plugin talks to Payload's Local API, not to your database directly.

## Documentation

| | |
| --- | --- |
| [Installation](https://payload-auth.dev/docs/getting-started/installation) | Install and wire up the plugin |
| [How it works](https://payload-auth.dev/docs/concepts/how-it-works) | The architecture |
| [Collections](https://payload-auth.dev/docs/concepts/collections) | What gets generated, and how to extend it |
| [Plugin options](https://payload-auth.dev/docs/reference/plugin-options) | Every option, with defaults |
| [Better Auth plugin support](https://payload-auth.dev/docs/reference/better-auth-plugins) | What is configured automatically |
| [Troubleshooting](https://payload-auth.dev/docs/troubleshooting) | Common problems |

## License

MIT
