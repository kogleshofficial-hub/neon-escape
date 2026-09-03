import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Neon Escape — Survive the Grid',
  description: 'A fast, free browser survival game. Dodge, dash, collect energy and survive the evolving neon arena.',
  keywords: ['neon escape','browser game','survival game','arcade game','free online game','html5 game'],
  metadataBase: new URL('https://neon-escape.vercel.app'),
  openGraph: {
    title: 'Neon Escape — Survive the Grid',
    description: 'How long can you survive?',
    type: 'website'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}