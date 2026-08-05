# payload-auth docs

The documentation site for [`payload-auth`](https://www.npmjs.com/package/payload-auth), built with
[Fumadocs](https://fumadocs.dev) on Next.js.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
pnpm types:check
```

## Layout

| Path | Contents |
| --- | --- |
| `content/docs` | All documentation, as MDX |
| `src/lib/source.ts` | Content source adapter and the LLM/Markdown URL helpers |
| `src/lib/shared.ts` | Site name, repo config and route constants |
| `src/lib/layout.shared.tsx` | Nav and layout options shared by all pages |
| `src/app/docs` | Docs layout and page renderer |
| `src/app/(home)` | Landing page |
| `src/app/api/search` | Search endpoint (built-in, no external service) |
| `src/proxy.ts` | Markdown content negotiation for docs URLs |

Page order and sidebar grouping come from `meta.json` files inside `content/docs`.

## Writing a page

Create an `.mdx` file under `content/docs` with frontmatter:

```mdx
---
title: My page
description: One sentence, used in search results and in llms.txt.
---
```

Then add its filename to the `pages` array of the sibling `meta.json`.

Components available in MDX without importing: `Callout`, `Card`, `Cards`, `Tabs`, `Tab`,
`Steps`, `Step`, `Accordion`, `Accordions`, `TypeTable`, and fumadocs' default set.
Fenced blocks tagged `package-install` render as package-manager tabs.

Icons in frontmatter and `meta.json` are [Lucide](https://lucide.dev) names, resolved
against the `icons` export of `lucide-react` — an unknown name logs a warning at build time
and renders nothing.

## AI agent endpoints

The site publishes its content as Markdown so coding agents can read it directly:

| Route | Contents |
| --- | --- |
| `/llms.txt` | Index of every page |
| `/llms-full.txt` | The whole site as one Markdown document |
| `/docs/<path>.md` | A single page as Markdown |

Requesting a docs URL with `Accept: text/markdown` returns Markdown instead of HTML;
`src/proxy.ts` handles that rewrite. Each page also renders a **Copy Markdown** button and
a view-options menu.

## Deployment

`vercel.json` at the repo root currently sets `git.deploymentEnabled: false`. Enable it, or
deploy this directory as its own project with `docs` as the root.

Set `NEXT_PUBLIC_SITE_URL` to the production origin so OG images and canonical URLs
resolve correctly. It defaults to `https://payload-auth.dev`.
