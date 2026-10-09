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

export const CATEGORY_HINTS: Record<PredictabilityCategory, string> = {
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

export const METRIC_HINTS = {
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
