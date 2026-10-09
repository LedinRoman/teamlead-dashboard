import type { MetricRules } from '@shared/types';

export const EXCLUDE_QA_STORAGE = 'cycle-overview.excludeQa';

export function readStoredExcludeQa(): boolean {
  try {
    return window.localStorage.getItem(EXCLUDE_QA_STORAGE) === '1';
  } catch {
    return false;
  }
}

export function writeStoredExcludeQa(value: boolean): void {
  try {
    window.localStorage.setItem(EXCLUDE_QA_STORAGE, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Settings flag, with the old per-page localStorage value until the user saves Settings. */
export function effectiveExcludeQa(rules: MetricRules): boolean {
  return Boolean(rules.excludeQaTitle) || readStoredExcludeQa();
}
