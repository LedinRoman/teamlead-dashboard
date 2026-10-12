import { AsyncLocalStorage } from 'node:async_hooks';

import { tr, type Locale } from '@shared/locale';

const requestLocale = new AsyncLocalStorage<Locale>();

export function localeFrom(request: Request): Locale {
  return request.headers.get('x-locale') === 'ru' ? 'ru' : 'en';
}

export function apiText(request: Request, en: string, ru: string): string {
  return tr(en, ru, localeFrom(request));
}

/** Error text for code that runs only on the server, inside `withLocale`. */
export function serverTr(en: string, ru: string): string {
  return tr(en, ru, requestLocale.getStore() ?? 'en');
}

export function withLocale<T>(request: Request, run: () => Promise<T>): Promise<T> {
  return requestLocale.run(localeFrom(request), run);
}
