import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: {
    default: 'STATUS: AVAILABLE — Websites with a point of view',
    template: '%s | STATUS: AVAILABLE'
  },
  description: 'Curated, customizable websites for independent brands.'
};

export default function PlatformLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <header className="shell nav">
        <Link className="brand" href="/">
          STATUS: AVAILABLE
        </Link>
        <nav className="navlinks" aria-label="Main navigation">
          <Link href="/#editions">Editions</Link>
          <Link href="/app">My space</Link>
        </nav>
      </header>
      {children}
      <footer className="shell foot">
        <strong>STATUS: AVAILABLE</strong>
        <span>Distinct by design. Independent by nature.</span>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </ClerkProvider>
  );
}
