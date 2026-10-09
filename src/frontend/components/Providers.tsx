'use client';

import type { ReactNode } from 'react';

import { AppDataProvider } from '@frontend/lib/app-data';

export function Providers({ children }: { children: ReactNode }) {
  return <AppDataProvider>{children}</AppDataProvider>;
}
