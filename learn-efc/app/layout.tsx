import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { AppShell } from '../components/AppShell';
import { SITE } from '../lib/site';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: '%s · learn.efc' },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    'backend tutorial',
    'learn backend development',
    'Node.js tutorial',
    'Express tutorial',
    'Express 5',
    'REST API tutorial',
    'express-file-cluster',
    'EFC',
    'file-based routing',
    'beginner backend course',
  ],
  authors: [{ name: 'Prashant Adhikari' }],
  creator: 'Prashant Adhikari',
  category: 'education',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    locale: SITE.locale,
    url: '/',
    title: SITE.title,
    description: SITE.description,
  },
  twitter: { card: 'summary_large_image', title: SITE.title, description: SITE.description },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f0e0c' },
    { media: '(prefers-color-scheme: light)', color: '#faf8f4' },
  ],
};

// Applies the saved theme before first paint so the page never flashes the wrong palette.
const themeScript = `try{var t=localStorage.getItem('efc_theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
