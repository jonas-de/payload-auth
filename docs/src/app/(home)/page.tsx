import Link from 'next/link';
import { appName, gitConfig, npmPackage } from '@/lib/shared';

const features = [
  {
    title: 'One session, everywhere',
    description:
      'The Payload admin panel and your frontend authenticate against the same Better Auth session. No second user table, no bridging code.',
  },
  {
    title: 'Collections generated for you',
    description:
      'Users, sessions, accounts and verifications are built from the Better Auth schema — plus a collection for every Better Auth plugin you enable.',
  },
  {
    title: 'Better Auth, unmodified',
    description:
      'The plugin swaps in a Payload database adapter. Every Better Auth feature, plugin and client method works exactly as documented.',
  },
  {
    title: 'Admin UI included',
    description:
      'Login, signup, forgot/reset password and 2FA views are replaced with Better Auth equivalents that respect your enabled login methods.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <section className="flex flex-col items-center text-center px-4 py-24 border-b">
        <p className="text-fd-muted-foreground text-sm mb-4 font-mono">
          {npmPackage}
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold max-w-3xl text-balance">
          Better Auth for Payload CMS
        </h1>
        <p className="mt-6 text-fd-muted-foreground max-w-2xl text-lg text-balance">
          {appName} replaces Payload&apos;s built-in authentication with{' '}
          <a
            href="https://www.better-auth.com"
            className="text-fd-foreground underline underline-offset-4"
          >
            Better Auth
          </a>
          , so your admin panel and your app share one auth system — social
          providers, passkeys, 2FA, organizations and all.
        </p>
        <div className="flex flex-wrap gap-3 justify-center mt-10">
          <Link
            href="/docs"
            className="px-5 py-2.5 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium text-sm"
          >
            Get started
          </Link>
          <Link
            href="/docs/getting-started/installation"
            className="px-5 py-2.5 rounded-lg border font-medium text-sm"
          >
            Installation
          </Link>
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            className="px-5 py-2.5 rounded-lg border font-medium text-sm"
          >
            GitHub
          </a>
        </div>
        <code className="mt-10 px-4 py-2 rounded-lg border bg-fd-card text-sm font-mono">
          pnpm add {npmPackage} better-auth
        </code>
      </section>

      <section className="grid sm:grid-cols-2 max-w-5xl w-full mx-auto">
        {features.map((feature) => (
          <div key={feature.title} className="p-8 border-b sm:odd:border-r">
            <h2 className="font-semibold mb-2">{feature.title}</h2>
            <p className="text-fd-muted-foreground text-sm leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </section>

      <section className="px-4 py-16 text-center">
        <h2 className="font-semibold mb-2">Built for AI coding agents</h2>
        <p className="text-fd-muted-foreground text-sm max-w-xl mx-auto">
          Every page is available as plain Markdown, and the whole site is
          published as{' '}
          <Link href="/llms.txt" className="underline underline-offset-4">
            llms.txt
          </Link>{' '}
          and{' '}
          <Link href="/llms-full.txt" className="underline underline-offset-4">
            llms-full.txt
          </Link>
          .{' '}
          <Link
            href="/docs/ai-agents"
            className="text-fd-foreground underline underline-offset-4"
          >
            Read the guide
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
