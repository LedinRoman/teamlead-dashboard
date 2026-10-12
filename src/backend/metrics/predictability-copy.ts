import type { Locale } from '@shared/locale';
import type { PredictabilityCategory } from './predictability-model';

export const PREDICTABILITY_TABLE_CATEGORIES: PredictabilityCategory[] = [
  'committed-completed',
  'spillover',
  'still-unfinished',
  'removed',
  'cancelled',
  'added-completed',
  'added-unfinished',
];

const CATEGORY_HINTS_RU: Record<PredictabilityCategory, string> = {
  'committed-completed':
    'Была в спринте на старте и впервые дошла до Проверки до конца окна. Это числитель Commitment reliability.',
  spillover:
    'Была в спринте на старте и не дошла до Проверки до конца закрытого спринта. Старый ключ здесь — перенос (carry-over), не случайная задача.',
  'still-unfinished':
    'Была в спринте на старте и ещё не дошла до Проверки, пока спринт открыт. Старый ключ — перенос из прошлых спринтов, он числился в этом спринте на старте.',
  removed: 'Была в commitment на старте и снята со спринта до конца окна. Не входит в spillover.',
  cancelled: 'Была в commitment, к концу окна статус из workflow.cancelled. Не считается выполненной.',
  'added-completed':
    'Добавлена в спринт после старта и впервые дошла до Проверки в этом окне. Unplanned delivered, не commitment.',
  'added-unfinished': 'Добавлена после старта и не дошла до Проверки. Не входит в initial commitment.',
  'already-done':
    'Уже была в Проверке до старта спринта. Скрыта из таблицы: это не commitment и не added.',
  excluded: 'Эпик, [QA] или ключ из исключений. Скрыта из таблицы и не входит в метрики.',
};

const METRIC_HINTS_RU = {
  reliability:
    'Commitment reliability = выполненные committed / initial committed × 100%. Выполнение = первый переход в Проверку (не Готово). В знаменателе только задачи, которые были в спринте на старте. Added не входят.',
  reliabilitySp:
    'То же отношение в Story Points baseline на старте (или на момент добавления). Задачи без SP не входят в знаменатель SP и не считаются нулём.',
  scopeAdded:
    'Added scope = задачи, которых не было в спринте на старте и которые появились после. Процент = added SP / initial committed SP × 100%. Если commitment без оценок — показываем абсолюты, не делим на ноль.',
  scopeDrop:
    'Scope drop = committed-задачи, снятые с поля Sprint в окне спринта. Процент = drop SP / initial committed SP × 100%. Это не spillover: drop ушла из спринта, spillover осталась и не дошла до Проверки.',
  throughput:
    'Throughput — первый переход в Проверку в календарном окне спринта (start → completeDate/end). Повторные визиты и Готово не добавляют счёт.',
  doneTotal:
    'Done total = committed completed + added completed. Выполнение = первая Проверка в окне спринта. Не путать с initial commitment.',
  spillover:
    'Committed, не достигшие Проверки до конца спринта. Пока спринт открыт, это Still unfinished — тот же состав, другое имя.',
  unplanned:
    'Added-задачи, впервые достигшие Проверки в окне спринта. Процент = unplanned задачи / все выполненные в спринте (committed completed + added completed). Это не «сверх commitment».',
  initial:
    'На старте = задачи, которые поле Sprint содержало в момент startDate. Не текущий состав борда. Carry-over со старым ключом сюда входит, если он был в спринте на старте.',
  added: 'Добавлено после startDate: первая постановка этого спринта в поле Sprint уже после старта.',
  removed: 'Снято с поля Sprint в окне спринта. Не путать со spillover: removed ушла из спринта, spillover осталась и не дошла до Проверки.',
  estimate:
    'Изменение оценки = сумма ростов / сумма снижений Story point estimate в окне, по changelog. Не путать с added/removed задачами.',
  final:
    'Финальный scope = committed completed + spillover/still unfinished + весь added. Не подставляется в reliability вместо initial commitment.',
  spBaseline:
    'SP baseline — оценка на старте спринта (committed) или на момент добавления (added). Missing SP ≠ 0.',
  spNow: 'Текущее значение Story point estimate в Jira, не обязательно то, что было в расчёте reliability.',
  spillovers:
    'Сколько закрытых спринтов подряд задача была членом и не доходила до Проверки. Считается по истории поля Sprint.',
  created:
    'Дата создания ключа. Старый ключ в таблице — нормально: это carry-over, если задача была в спринте на старте, добавлена или снята.',
};

export const CATEGORY_HINTS: Record<PredictabilityCategory, string> = {
  'committed-completed':
    'It was in the sprint at the start and reached review for the first time before the window ended. This is the commitment reliability numerator.',
  spillover:
    'It was in the sprint at the start and did not reach review before a closed sprint ended. An old key here is a carry-over, not a random issue.',
  'still-unfinished':
    'It was in the sprint at the start and has not reached review while the sprint is still open. An old key is a carry-over from earlier sprints.',
  removed: 'It was in the commitment at the start and was taken out of the sprint before the window ended. Not spillover.',
  cancelled: 'It was in the commitment, and by the end of the window the status is one of workflow.cancelled. Not counted as done.',
  'added-completed':
    'Added to the sprint after the start and reached review for the first time in this window. Unplanned delivered, not commitment.',
  'added-unfinished': 'Added after the start and has not reached review. Not part of the initial commitment.',
  'already-done': 'Already in review before the sprint started. Hidden from the table: not commitment and not added.',
  excluded: 'Epic, a [QA] title, or a key from the exclusion list. Hidden from the table and from the metrics.',
};

export const METRIC_HINTS = {
  reliability:
    'Commitment reliability = completed committed / initial committed × 100%. Done means the first transition into review, not Done. The denominator is only issues that were in the sprint at the start. Added issues are excluded.',
  reliabilitySp:
    'The same ratio in story points, using the baseline at the start (or at the moment an issue was added). Unestimated issues are left out of the SP denominator. They are not treated as zero.',
  scopeAdded:
    'Added scope = issues that were not in the sprint at the start and appeared later. Percent = added SP / initial committed SP × 100%. If the commitment has no estimates, the absolute numbers are shown.',
  scopeDrop:
    'Scope drop = committed issues removed from the Sprint field during the sprint. Percent = drop SP / initial committed SP × 100%. This is not spillover: a drop left the sprint, spillover stayed and did not reach review.',
  throughput:
    'Throughput is the first transition into review inside the sprint calendar window. Repeat visits and Done do not add to the count.',
  doneTotal:
    'Done total = committed completed + added completed. Done means the first review inside the sprint window. This is not the initial commitment.',
  spillover:
    'Committed issues that did not reach review before the sprint ended. While the sprint is open, the same issues are called Still unfinished.',
  unplanned:
    'Added issues that reached review for the first time in the sprint window. Percent = unplanned issues / everything completed in the sprint. This is not “above commitment”.',
  initial:
    'At the start = issues the Sprint field contained at startDate. Not the current board contents. A carry-over with an old key is included if it was in the sprint at the start.',
  added: 'Added after startDate: the first time this sprint was set on the Sprint field, and that was after the start.',
  removed:
    'Removed from the Sprint field during the sprint. Not spillover: removed left the sprint, spillover stayed and did not reach review.',
  estimate:
    'Estimate change = the sum of story-point increases and decreases in the window, from the changelog. Not the same as added or removed issues.',
  final:
    'Final scope = committed completed + spillover or still unfinished + all added. It does not replace the initial commitment in reliability.',
  spBaseline:
    'SP baseline is the estimate at the sprint start (committed) or when the issue was added. A missing estimate is not zero.',
  spNow: 'The current story point estimate in Jira. It is not necessarily the value used for reliability.',
  spillovers:
    'How many closed sprints in a row the issue was a member and did not reach review. Counted from the Sprint field history.',
  created:
    'When the key was created. An old key in the table is normal: it is a carry-over if the issue was in the sprint at the start, added, or removed.',
};

export function categoryHints(locale: Locale): Record<PredictabilityCategory, string> {
  return locale === 'ru' ? CATEGORY_HINTS_RU : CATEGORY_HINTS;
}

export function metricHints(locale: Locale): typeof METRIC_HINTS {
  return locale === 'ru' ? METRIC_HINTS_RU : METRIC_HINTS;
}
