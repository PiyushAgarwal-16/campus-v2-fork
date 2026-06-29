import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'Campusly',
  description: "India's digital campus — a verified, student-only social platform.",
};

export const viewport: Viewport = {
  themeColor: '#FF9900',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${sora.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
