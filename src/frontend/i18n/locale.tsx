'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setActiveLocale, tr, type Locale } from '@shared/locale';

const STORAGE_KEY = 'tld.locale';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (en: string, ru: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') {
      setActiveLocale(stored);
      setLocaleState(stored);
    }
    document.documentElement.lang = stored === 'ru' ? 'ru' : 'en';
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      setLocale: (next) => {
        const localeNext: Locale = next === 'ru' ? 'ru' : 'en';
        setActiveLocale(localeNext);
        window.localStorage.setItem(STORAGE_KEY, localeNext);
        setLocaleState(localeNext);
      },
      t: (en, ru) => tr(en, ru, locale),
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>
      <div key={locale} style={{ display: 'contents' }}>
        {children}
      </div>
    </LocaleContext.Provider>
  );
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    return {
      locale: 'en',
      setLocale: () => {},
      t: (en) => en,
    };
  }
  return value;
}
