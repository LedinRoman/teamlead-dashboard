export type Locale = 'en' | 'ru';

let current: Locale = 'en';

export function activeLocale(): Locale {
  return current;
}

export function setActiveLocale(locale: Locale): void {
  current = locale === 'ru' ? 'ru' : 'en';
}

export function isRu(): boolean {
  return current === 'ru';
}

/** Pick a sentence. English is the default. */
export function tr(en: string, ru: string, locale: Locale = current): string {
  return locale === 'ru' ? ru : en;
}

const RU_LABELS: Record<string, string> = {
  'In progress': 'В работе',
  Development: 'Разработка',
  Review: 'Ревью',
  'In review': 'На проверке',
  'QA WIP': 'QA WIP',
  QA: 'QA',
  'Awaiting release': 'Ждёт релиза',
  'To do': 'К выполнению',
  Done: 'Готово',
  Cancelled: 'Отменено',
  Other: 'Другое',
  Blocked: 'Заблокировано',
};

/** Known stage and episode names. Jira status names are left as the board wrote them. */
export function uiLabel(text: string, locale: Locale = current): string {
  if (locale !== 'ru') return text;
  return RU_LABELS[text] ?? text;
}
