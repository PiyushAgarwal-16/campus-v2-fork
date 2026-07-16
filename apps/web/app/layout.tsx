import type { Metadata, Viewport } from 'next';
import { Inter, Sora, Great_Vibes } from 'next/font/google';
import { Providers } from './providers';
import '../styles/globals.css';

// Inter — recommended typeface (UI_GUIDELINES.md §5), exposed as a CSS variable.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Sora — premium display face used for the brand wordmark / landing headlines.
const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});
// Great_Vibes — premium script/cursive font for taglines.
const greatVibes = Great_Vibes({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-cursive',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AnonymousU',
  description: "India's digital campus — a verified, student-only social platform.",
};

export const viewport: Viewport = {
  themeColor: '#FF9900',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${sora.variable} ${greatVibes.variable}`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="AnonymousU" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
