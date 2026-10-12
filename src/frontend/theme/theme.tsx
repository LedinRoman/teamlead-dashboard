'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useI18n } from '@frontend/i18n/locale';

export const THEME_STORAGE_KEY = 'tld.theme';

export const THEMES = [
  { id: 'light', en: 'Light', ru: 'Светлая' },
  { id: 'dark', en: 'Dark', ru: 'Тёмная' },
  { id: 'paper', en: 'Paper', ru: 'Бумага' },
  { id: 'sea', en: 'Sea', ru: 'Море' },
  { id: 'dusk', en: 'Dusk', ru: 'Сумерки' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && THEME_IDS.has(value));
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(stored)) {
      applyTheme(stored);
      setThemeState(stored);
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (next) => {
        applyTheme(next);
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
        setThemeState(next);
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) return { theme: 'light', setTheme: () => {} };
  return value;
}

export function ThemePicker() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-picker" role="radiogroup" aria-label={t('Color theme', 'Цветовая тема')}>
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={theme === item.id}
          data-active={theme === item.id}
          onClick={() => setTheme(item.id)}
        >
          <span className="theme-swatch" data-preview={item.id}>
            <span className="theme-swatch-bar" />
            <span className="theme-swatch-card" />
          </span>
          {t(item.en, item.ru)}
        </button>
      ))}
    </div>
  );
}
