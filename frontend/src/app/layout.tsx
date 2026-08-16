import type { Metadata, Viewport } from 'next';
import { Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { ThemeWatcher } from '@/components/theme-watcher';
import './globals.css';

/**
 * One family, both --font-sans and --font-mono (globals.css) — the
 * terminal-fintech visual direction the team approved runs monospace
 * throughout, not just in numeric/code contexts.
 */
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FinTalk AI',
  description: 'Audited meeting capture for Malaysian financial institutions',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#070a10' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={geistMono.variable}>
      <head>
        {/*
          Runs before first paint so a stored theme choice never flashes the
          wrong colors first. Mirrors lib/theme.ts's resolveTheme() logic
          inline in plain JS — this executes before any module import is
          possible, so it cannot import that function directly, and it must
          read the exact same storage key lib/theme.ts writes
          ('fintalk-theme') or the two would disagree. Wrapped in try/catch:
          a browser with storage blocked (private mode, disabled cookies)
          must still render.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var stored = localStorage.getItem('fintalk-theme');
                var theme = stored === 'light' || stored === 'dark'
                  ? stored
                  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                document.documentElement.setAttribute('data-theme', theme);
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {/*
          Renders nothing; it keeps a 'system' theme preference tracking the OS
          after load, which the pre-paint script above cannot do — that runs
          once and then the page is static.
        */}
        <ThemeWatcher />

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
        >
          Skip to content
        </a>

        {/*
          No header here: the signed-in area supplies its own in
          app/(app)/layout.tsx, and the sign-in page deliberately has none. The
          footer's data-handling and non-certification notices apply everywhere.
        */}
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
