import type { Metadata, Viewport } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const viewport: Viewport = {
  themeColor: '#020910',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
};

export const metadata: Metadata = {
  title: 'MOBI.DIGITAL // Global Intelligence',
  description: 'AI-assisted global situational awareness built from attributed public data sources.',
  applicationName: 'MOBI.DIGITAL Global Intelligence',
  manifest: '/manifest.json',
  icons: { icon: '/mobi-mark.svg' },
  robots: { index: false, follow: false },
  openGraph: {
    title: 'MOBI.DIGITAL // Global Intelligence',
    description: 'Live public data, geospatial monitoring and an AI-assisted intelligence brief.',
    type: 'website',
    siteName: 'MOBI.DIGITAL',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
