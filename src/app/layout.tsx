import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@frontend/components/AppShell';
import { Providers } from '@frontend/components/Providers';
import '../frontend/styles/globals.css';

export const metadata: Metadata = {
  title: 'Team Lead Dashboard',
  description: 'Sprint, flow, predictability and quality for a Jira team. Your token stays in your database.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
