# payload-auth

Better Auth for [Payload CMS](https://payloadcms.com). One auth system for your admin panel and your app.

📖 **[Documentation](https://payload-auth.dev)** · 📦 **[npm](https://www.npmjs.com/package/payload-auth)** · 🤖 **[llms.txt](https://payload-auth.dev/llms.txt)**

```bash
pnpm add payload-auth better-auth
```

```ts
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

See the [installation guide](https://payload-auth.dev/docs/getting-started/installation) to get started.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/payload-auth` | The published plugin and database adapter |
| `docs` | The documentation site ([Fumadocs](https://fumadocs.dev)) |
| `demo` | A Next.js + Payload app exercising the plugin |
| `dev-docs` | Internal architecture, audit and test-plan notes |
| `plans` | Implementation plans |

## Development

```bash
pnpm install
pnpm build          # build the plugin
pnpm dev            # watch the plugin and run the demo
pnpm test           # run the plugin test suite
pnpm test:run       # single test run
```

The test suite needs Postgres. Start one with the bundled compose file:

```bash
docker compose -f docker-compose.test.yml up -d
```

To work on the documentation site:

```bash
pnpm --filter payload-auth-docs dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
