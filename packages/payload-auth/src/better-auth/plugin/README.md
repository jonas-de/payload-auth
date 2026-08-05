# Better Auth plugin for Payload CMS

Replaces Payload's built-in authentication with [Better Auth](https://www.better-auth.com),
so the admin panel and your application share one auth system.

Full documentation: <https://payload-auth.dev>

## Usage

```ts
import { buildConfig } from 'payload'
import { betterAuthPlugin } from 'payload-auth/better-auth'

export default buildConfig({
  admin: { user: 'users' },
  plugins: [
    betterAuthPlugin({
      users: { roles: ['user', 'admin'], adminRoles: ['admin'] },
      betterAuthOptions: {
        emailAndPassword: { enabled: true },
      },
    }),
  ],
})
```

## What it does

Given `PayloadAuthOptions`, the plugin:

1. Infers `admin.loginMethods` from your providers and plugins, unless you set it.
2. Derives the Better Auth schema for the models your plugins require.
3. Builds Payload collections from that schema — twice, so cross-collection references
   (hooks, endpoints) resolve against final slugs.
4. Runs `sanitizeBetterAuthOptions`, rewriting `modelName` and field mappings to address
   your real Payload slugs and field names.
5. Replaces the admin login, signup, forgot/reset password and 2FA views.
6. Registers an `onInit` hook that constructs Better Auth with the Payload adapter and
   attaches it to `payload.betterAuth`.

The generated `users` collection also declares an auth strategy that resolves Better Auth
sessions for the admin panel, with `disableRefresh: true` so it never emits `Set-Cookie`.

## Key exports

| Export | Purpose |
| --- | --- |
| `betterAuthPlugin(options)` | The Payload plugin |
| `getPayloadAuth<O>(config)` | Payload with a typed `betterAuth` attached |
| `generateVerifyEmailUrl(options)` | Build a signed email-verification URL |
| `sanitizeBetterAuthOptions(...)` | Internal option resolution, exported for inspection |

Types: `PayloadAuthOptions`, `BetterAuthOptions`, `BetterAuthReturn`, `LoginMethod`,
`SocialProvider`, `PayloadRequestWithBetterAuth`, `CollectionHookWithBetterAuth`,
`EndpointWithBetterAuth`.

## Reference

- [Plugin options](https://payload-auth.dev/docs/reference/plugin-options)
- [Collections](https://payload-auth.dev/docs/concepts/collections)
- [Admin panel integration](https://payload-auth.dev/docs/concepts/admin-panel)
- [Better Auth plugin support](https://payload-auth.dev/docs/reference/better-auth-plugins)
