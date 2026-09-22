import type { Metadata, Viewport } from 'next';
import { Anybody, Dancing_Script, Instrument_Sans } from 'next/font/google';
import { ThemeProvider } from '@/components/app/theme-provider';
import { themeScript } from '@/lib/theme';
import './globals.css';

const display = Anybody({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-anybody',
  display: 'swap',
});

const body = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-instrument',
  display: 'swap',
});

// Typed signatures, matching the face the signed PDF draws them in (pdf/fonts). Not preloaded: only the signing
// screens use it.
const signature = Dancing_Script({
  subsets: ['latin'],
  weight: '500',
  variable: '--font-dancing-script',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: { default: 'Unbuilt OS', template: '%s | Unbuilt OS' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en-NG"
      className={`${display.variable} ${body.variable} ${signature.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets the theme before first paint. A static string, never user input. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
