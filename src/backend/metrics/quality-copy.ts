/**
 * Locked Quality (QA Returns / Rework Loops) rules. Stage 1 encodes these in
 * classify + snapshot; UI must not invent a second reading.
 *
 * Events come from changelog status transitions. `bugs after test` is not an
 * MVP dependency. Flow / Predictability completion stays first Проверка.
 */
export const QUALITY_FIX_STATUS = 'Fix';

export const QUALITY_SPEC = {
  qaGroup: ['Ready to QA', 'Проверка'] as const,
  /** First entry into either QA-group status over the issue lifetime. */
  firstQa:
    'First QA Entry — первый вход в Ready to QA или Проверку за историю задачи. Прямой вход в Проверку без предшествующего Ready to QA тоже учитывается.',
  internalQa:
    'Переходы между Ready to QA и Проверкой — внутренние перемещения внутри QA: они не создают новый вход или возврат.',
  reworkCompletesOnQa:
    'После доработки вход в любой статус QA-группы завершает rework-цикл. Rework Time — время до повторной передачи в QA, включая ожидание разработки, без последующего ожидания проверки.',
  fixOnly: 'Fix — только явно настроенный статус Fix.',
  returnDefinition:
    'Возврат — переход из любого статуса QA-группы в Fix. QA → In Progress / В работе не считается возвратом. Путь QA → Fix → In Progress → QA содержит один возврат и один завершённый цикл.',
  doneInterrupts:
    'Готово прерывает открытый rework-цикл как interrupted на timestamp этого перехода. Цикл исключается из Rework WIP и из median/P85 завершённых, сохраняется в детализации с причиной, не отменяет уже зарегистрированный QA Return. Последующее переоткрытие не возобновляет прерванный цикл.',
  excludeQaTitle:
    'Исключение [QA]-задач переиспользует excludeQaTitle / isCycleExcluded из Overview/Flow. Отдельной эвристики по названиям для Quality нет. Применяется в аналитическом слое: когорта, числители, знаменатели, циклы, исторические графики.',
  eventsFrom: 'changelog',
  bugsAfterTestNotRequired: true,
  completionUnchanged: true,
  cohort:
    'Когорта спринта — задачи, чей First QA Entry попадает в полуинтервал [startDate, completeDate ?? endDate); для active end = asOf. При пересечении окон — более ранний startDate, затем меньший id.',
  unknownHistory:
    'Неполная история не выдаётся за первый фактический QA и не кладётся в корзину 0 возвратов. Точный Rate по всей когорте не показывается, пока числитель или знаменатель неполны.',
  emptyRate: 'При N = 0 Rate недоступен, не 0%.',
  fpy: 'First Pass Yield — доля задач с известным исходом первого прохода: дошли до Готово без QA→Fix, среди тех, чей первый проход уже завершился. Задачи ещё в QA или в доработке без возврата в выборку не входят. Не корзина «0 возвратов».',
  returnReasons:
    'Причина возврата — соседние поля того же changelog-события, что QA→Fix (комментарий, метка, resolution, кастомное поле). Таксономию дефектов из текста не выводим. Пустое событие — «Не записана», не «нет бага».',
  defects:
    'Production/инцидент — баг или инцидент, созданный в окне спринта, с признаком: тип Incident, метка production/hotfix/инцидент, или связь с задачей, которая уже была в Готово на момент создания. Баг из когорты First QA — находка QA, не production. Без признака не называем production.',
  bugsAfterTestDiagnostic:
    'Поле bugs after test — только сверка со счётчиком QA→Fix из changelog. Не источник когорты, Rate, FPY и не замена возвратов.',
} as const;

export const QUALITY_FORMULAS = {
  n: 'N = задачи когорты с известным First QA и полной историей',
  r: 'R = задачи с rᵢ ≥ 1',
  r2: 'R₂ = задачи с rᵢ ≥ 2',
  loops: 'L = сумма завершённых (не interrupted, не open) rework-циклов',
  rate: 'Rate = R / N при N > 0 и nUnknown = 0, иначе недоступен',
  fpy: 'FPY = Passed / (Passed + Failed); Passed = 0 возвратов и Готово; Failed = ≥1 QA→Fix; Pending (0 возвратов, ещё не Готово) вне знаменателя; при nUnknown > 0 недоступен',
} as const;

export const QUALITY_HINTS = {
  rate: 'Доля задач когорты, у которых был хотя бы один переход из QA-группы в Fix. Не First Pass Yield. При неполной истории процент недоступен, а не 0%.',
  loops: 'Число завершённых rework-циклов: от возврата в Fix до следующего входа в Ready to QA или Проверку. Прерванные Готово и открытые циклы сюда не входят.',
  repeated: 'Сколько задач когорты вернулись в Fix дважды или чаще.',
  reworkTime: 'Median и P85 длительности завершённых циклов: время до повторной передачи в QA, без последующего ожидания проверки. Открытые и interrupted не входят.',
  firstQa: 'Первый вход в Ready to QA или Проверку за историю задачи. Когорта спринта — по этой дате, не по текущему полю Sprint.',
  returns: 'Число переходов QA-группа → Fix. Переходы внутри QA и QA → In Progress не считаются.',
  distribution:
    'Сколько задач когорты с 0, 1, 2 или 3+ наблюдаемыми возвратами. 0 — пока без возвратов, не First Pass Yield. Unknown — неполная история, не кладётся в ноль.',
  openCycles: 'Открытый цикл после QA → Fix, пока задача не вернулась в QA и не ушла в Готово. Возраст — до asOf снимка. Не путать с Flow Rework.',
  history:
    'Каждый спринт — своя когорта First QA и свой Return Rate. Поздний возврат остаётся в исходной когорте. Активный спринт помечен как неполный и не входит в итог закрытых.',
  fpy: 'Доля задач, прошедших первый QA без возврата в Fix и уже дошедших до Готово. Не «0 возвратов»: ещё проверяемые туда не входят. При неполной истории процент недоступен.',
  reasons: 'Что лежало в том же changelog, что переход QA→Fix. Это не классификация дефектов и не оценка людей.',
  defects: 'Баги и инциденты, созданные в окне спринта, с признаком production. Находки QA из когорты First QA сюда не входят.',
  bugsAfterTest: 'Сверка поля bugs after test со счётчиком QA→Fix. Поле не двигает карточки Quality.',
} as const;
