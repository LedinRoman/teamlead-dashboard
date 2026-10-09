import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import type { FlowSnapshot } from '@backend/metrics/flow-model';

export function FlowSummaryCards({
  flow,
  onSelect,
}: {
  flow: FlowSnapshot;
  onSelect: (filter: 'developmentWip' | 'qaWip' | 'inReview' | 'blocked' | 'oldest') => void;
}) {
  return (
    <div className="stat-bar cycle-stats flow-stats">
      <button
        type="button"
        className="stat flow-stat"
        title="Задачи, которые сейчас требуют работы разработчиков: разработка и ревью. Не Проверка и не очередь QA."
        onClick={() => onSelect('developmentWip')}
      >
        <span className="stat-label">Development WIP</span>
        <span className="stat-value">{flow.developmentWip}</span>
        <span className="stat-hint">Сейчас требует работы разработчиков</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Очередь и работа QA до перехода в Проверку или Fix. Сама Проверка сюда не входит."
        onClick={() => onSelect('qaWip')}
        disabled={!flow.qaWipAvailable}
      >
        <span className="stat-label">QA WIP</span>
        <span className="stat-value">{flow.qaWipAvailable ? flow.qaWip : '—'}</span>
        <span className="stat-hint">
          {flow.qaWipAvailable
            ? 'В очереди QA, пока не уйдёт в Проверку или Fix'
            : flow.qaUnavailableReason ?? 'QA WIP недоступен'}
        </span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Текущий статус Проверка. Это не обязательно активное тестирование и не конец Cycle Time для Aging."
        onClick={() => onSelect('inReview')}
      >
        <span className="stat-label">В проверке</span>
        <span className="stat-value">{flow.inReview}</span>
        <span className="stat-hint">Текущий статус, не обязательно активное тестирование</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Активные задачи в blocked-статусе или с blocked-меткой, которые ещё в Development WIP, ревью или QA."
        onClick={() => onSelect('blocked')}
      >
        <span className="stat-label">Blocked</span>
        <span className="stat-value">{flow.blocked}</span>
        <span className="stat-hint">Активные заблокированные задачи</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Самая старая активная задача по возрасту текущего эпизода (не с даты создания ключа)."
        onClick={() => onSelect('oldest')}
        disabled={!flow.oldest}
      >
        <span className="stat-label">Oldest WIP</span>
        <span className="stat-value">
          {flow.oldest ? flow.oldest.key : '—'}
        </span>
        <span className="stat-hint">
          {flow.oldest
            ? `${flow.oldest.episodeLabel}: ${formatCycleDuration(flow.oldest.episodeDays)}`
            : 'Самая старая активная задача'}
        </span>
      </button>
    </div>
  );
}
