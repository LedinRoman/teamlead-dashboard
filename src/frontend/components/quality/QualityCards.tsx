import { useI18n } from '@frontend/i18n/locale';
import { Hint } from '@frontend/components/ui';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import { qualityHints } from '@backend/metrics/quality-copy';
import type { QualitySnapshot } from '@backend/metrics/quality-model';
import type { QualityTableFilter } from './QualityTaskTable';

export function QualityCards({
  snapshot,
  filter,
  onFilter,
}: {
  snapshot: QualitySnapshot;
  filter: QualityTableFilter;
  onFilter: (filter: QualityTableFilter) => void;
}) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  const rateLabel =
    snapshot.rate === null ? t('No data', 'Нет данных') : `${Math.round(snapshot.rate * 100)}%`;
  const median = snapshot.reworkSummary?.median;
  const p85 = snapshot.reworkSummary?.p85;
  const cycleN = snapshot.reworkSummary?.count ?? 0;
  return (
    <div className="stat-bar quality-stats">
      <button
        type="button"
        className="stat"
        data-active={filter === 'returns'}
        onClick={() => onFilter('returns')}
      >
        <span className="stat-label">
          <Hint text={hints.rate}>{t('Return Rate', 'Return Rate')}</Hint>
        </span>
        <span className="stat-value">{rateLabel}</span>
        <span className="stat-hint">
          {snapshot.n === 0
            ? t('no cohort', 'нет когорты')
            : t(`${snapshot.r} of ${snapshot.n} issues`, `${snapshot.r} из ${snapshot.n} задач`)}
        </span>
        {snapshot.nUnknown > 0 && (
          <span className="stat-hint">
            {t(`${snapshot.nUnknown} more with incomplete history`, `ещё ${snapshot.nUnknown} с неполной историей`)}
          </span>
        )}
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'firstPass'}
        onClick={() => onFilter('firstPass')}
      >
        <span className="stat-label">
          <Hint text={hints.fpy}>{t('First Pass Yield', 'First Pass Yield')}</Hint>
        </span>
        <span className="stat-value">
          {snapshot.firstPass.fpy === null ? t('No data', 'Нет данных') : `${Math.round(snapshot.firstPass.fpy * 100)}%`}
        </span>
        <span className="stat-hint">
          {snapshot.firstPass.passed + snapshot.firstPass.failed === 0
            ? t('no finished first pass', 'нет завершённого первого прохода')
            : t(
                `${snapshot.firstPass.passed} reached Done without a return · ${snapshot.firstPass.failed} returned`,
                `${snapshot.firstPass.passed} дошли до Готово без возврата · ${snapshot.firstPass.failed} с возвратом`,
              )}
        </span>
        {snapshot.firstPass.pending > 0 && (
          <span className="stat-hint">
            {t(`${snapshot.firstPass.pending} still open, not in FPY`, `${snapshot.firstPass.pending} ещё открыты, не входят в FPY`)}
          </span>
        )}
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'completed'}
        onClick={() => onFilter('completed')}
      >
        <span className="stat-label">
          <Hint text={hints.loops}>{t('Rework Loops', 'Rework Loops')}</Hint>
        </span>
        <span className="stat-value">{snapshot.loops}</span>
        <span className="stat-hint">
          {t(
            `completed cycles · ${snapshot.r} ${taskWord(snapshot.r, 'en')} returned`,
            `завершённые циклы · ${snapshot.r} ${taskWord(snapshot.r, 'ru')} с возвратом`,
          )}
        </span>
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'repeated'}
        onClick={() => onFilter('repeated')}
      >
        <span className="stat-label">
          <Hint text={hints.repeated}>{t('Repeated Rework', 'Повторная доработка')}</Hint>
        </span>
        <span className="stat-value">{snapshot.r2}</span>
        <span className="stat-hint">
          {t(
            `${taskWord(snapshot.r2, 'en')} with two or more returns`,
            `${taskWord(snapshot.r2, 'ru')} с двумя и более возвратами`,
          )}
        </span>
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'completed'}
        onClick={() => onFilter('completed')}
      >
        <span className="stat-label">
          <Hint text={hints.reworkTime}>{t('Rework Time', 'Время доработки')}</Hint>
        </span>
        <span className="stat-value">
          {median === undefined ? t('No data', 'Нет данных') : formatCycleDuration(median)}
        </span>
        <span className="stat-hint">
          {cycleN === 0
            ? t('no completed cycles', 'нет завершённых циклов')
            : t(
                `median · P85 ${p85 === undefined ? '—' : formatCycleDuration(p85)} · n=${cycleN}`,
                `медиана · P85 ${p85 === undefined ? '—' : formatCycleDuration(p85)} · n=${cycleN}`,
              )}
        </span>
        <span className="stat-hint">{t(`open cycles: ${snapshot.reworkWip}`, `открытые циклы: ${snapshot.reworkWip}`)}</span>
      </button>
    </div>
  );
}

function taskWord(count: number, locale: 'en' | 'ru'): string {
  if (locale !== 'ru') return count === 1 ? 'issue' : 'issues';
  const n10 = Math.abs(count) % 10;
  const n100 = Math.abs(count) % 100;
  if (n10 === 1 && n100 !== 11) return 'задача';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'задачи';
  return 'задач';
}
