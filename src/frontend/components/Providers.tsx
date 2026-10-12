'use client';

import type { ReactNode } from 'react';

import { LocaleProvider } from '@frontend/i18n/locale';
import { AppDataProvider } from '@frontend/lib/app-data';
import { ThemeProvider } from '@frontend/theme/theme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AppDataProvider>{children}</AppDataProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
