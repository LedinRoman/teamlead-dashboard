'use client';

import type { ReactNode } from 'react';

import { LocaleProvider } from '@frontend/i18n/locale';
import { AppDataProvider } from '@frontend/lib/app-data';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <AppDataProvider>{children}</AppDataProvider>
    </LocaleProvider>
  );
}
