import { useI18n } from '@frontend/i18n/locale';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import type { FlowSnapshot } from '@backend/metrics/flow-model';
import { uiLabel } from '@shared/locale';

export function FlowSummaryCards({
  flow,
  onSelect,
}: {
  flow: FlowSnapshot;
  onSelect: (filter: 'developmentWip' | 'qaWip' | 'inReview' | 'blocked' | 'oldest') => void;
}) {
  const { t } = useI18n();
  return (
    <div className="stat-bar cycle-stats flow-stats">
      <button
        type="button"
        className="stat flow-stat"
        title={t(
          'Issues that need a developer right now: development and review. Not In review, and not the QA queue.',
          'Задачи, которым сейчас нужен разработчик: разработка и ревью. Не «В проверке» и не очередь QA.',
        )}
        onClick={() => onSelect('developmentWip')}
      >
        <span className="stat-label">{t('Development WIP', 'Development WIP')}</span>
        <span className="stat-value">{flow.developmentWip}</span>
        <span className="stat-hint">{t('Needs a developer right now', 'Сейчас нужен разработчик')}</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title={t(
          'QA queue and QA work before In review or Fix. In review itself is not included.',
          'Очередь QA и работа QA до Проверки или Fix. Сама Проверка сюда не входит.',
        )}
        onClick={() => onSelect('qaWip')}
        disabled={!flow.qaWipAvailable}
      >
        <span className="stat-label">{t('QA WIP', 'QA WIP')}</span>
        <span className="stat-value">{flow.qaWipAvailable ? flow.qaWip : '—'}</span>
        <span className="stat-hint">
          {flow.qaWipAvailable
            ? t('In the QA queue, until In review or Fix', 'В очереди QA, пока не Проверка или Fix')
            : flow.qaUnavailableReason ?? t('QA WIP unavailable', 'QA WIP недоступен')}
        </span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title={t(
          'Current status is In review. That is not necessarily active testing, and it is not the end of cycle time for aging.',
          'Текущий статус — Проверка. Это не обязательно активное тестирование и не конец cycle time для Aging.',
        )}
        onClick={() => onSelect('inReview')}
      >
        <span className="stat-label">{t('In review', 'В проверке')}</span>
        <span className="stat-value">{flow.inReview}</span>
        <span className="stat-hint">{t('Current status, not necessarily active testing', 'Текущий статус, не обязательно активное тестирование')}</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title={t(
          'Active issues in a blocked status or with a blocked label, still in development, review, or QA.',
          'Активные задачи в статусе blocked или с меткой blocked, ещё в разработке, ревью или QA.',
        )}
        onClick={() => onSelect('blocked')}
      >
        <span className="stat-label">{t('Blocked', 'Заблокировано')}</span>
        <span className="stat-value">{flow.blocked}</span>
        <span className="stat-hint">{t('Active blocked issues', 'Активные заблокированные задачи')}</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title={t(
          'Oldest active issue by the current episode, not by when the key was created.',
          'Самая старая активная задача по текущему эпизоду, а не по дате создания ключа.',
        )}
        onClick={() => onSelect('oldest')}
        disabled={!flow.oldest}
      >
        <span className="stat-label">{t('Oldest WIP', 'Самый старый WIP')}</span>
        <span className="stat-value">
          {flow.oldest ? flow.oldest.key : '—'}
        </span>
        <span className="stat-hint">
          {flow.oldest
            ? `${uiLabel(flow.oldest.episodeLabel)}: ${formatCycleDuration(flow.oldest.episodeDays)}`
            : t('Oldest active issue', 'Самая старая активная задача')}
        </span>
      </button>
    </div>
  );
}
