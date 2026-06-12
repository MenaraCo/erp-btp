import type { Metadata } from 'next';
import './globals.css';
import './liquid-glass.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ERP BTP',
  description: 'ERP SaaS pour le BTP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
