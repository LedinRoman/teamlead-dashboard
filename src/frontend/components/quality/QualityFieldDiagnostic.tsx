import { useI18n } from '@frontend/i18n/locale';
import { qualityHints } from '@backend/metrics/quality-copy';
import type { QualityFieldDiagnostic as QualityFieldDiagnosticModel } from '@backend/metrics/quality-model';

export function QualityFieldDiagnosticPanel({ diagnostic }: { diagnostic?: QualityFieldDiagnosticModel }) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  if (!diagnostic) {
    return (
      <p className="caption">
        {t(
          'The bugs-after-test field was not found on this Jira. The counter is not used.',
          'Поле bugs after test на этом Jira не найдено. Счётчик не используется.',
        )}{' '}
        {hints.bugsAfterTest}
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="caption">
        {t(
          `Comparing “${diagnostic.fieldName}” with the QA → Fix count from the changelog.`,
          `Сверка «${diagnostic.fieldName}» со счётчиком QA→Fix из changelog.`,
        )}{' '}
        {hints.bugsAfterTest}
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('Comparison', 'Сравнение')}</th>
              <th className="num">{t('Issues', 'Задач')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('Matched', 'Совпало')}</td>
              <td className="num">{diagnostic.match}</td>
            </tr>
            <tr>
              <td>{t('In the changelog, field is 0 or empty', 'Есть в changelog, в поле 0 или пусто')}</td>
              <td className="num">{diagnostic.changelogOnly}</td>
            </tr>
            <tr>
              <td>{t('In the field, changelog is 0', 'Есть в поле, в changelog 0')}</td>
              <td className="num">{diagnostic.fieldOnly}</td>
            </tr>
            <tr>
              <td>{t('Both present, numbers differ', 'Оба есть, числа разные')}</td>
              <td className="num">{diagnostic.disagree}</td>
            </tr>
            <tr>
              <td>{t('Field is empty', 'Поле пустое')}</td>
              <td className="num">{diagnostic.missingField}</td>
            </tr>
            <tr>
              <td>{t('Issues with a full history compared', 'Сравнено задач с полной историей')}</td>
              <td className="num">{diagnostic.compared}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
