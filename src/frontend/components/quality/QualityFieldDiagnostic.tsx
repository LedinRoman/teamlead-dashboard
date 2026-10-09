import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
import type { QualityFieldDiagnostic as QualityFieldDiagnosticModel } from '@backend/metrics/quality-model';

export function QualityFieldDiagnosticPanel({ diagnostic }: { diagnostic?: QualityFieldDiagnosticModel }) {
  if (!diagnostic) {
    return (
      <p className="caption">
        Поле bugs after test на этом Jira не найдено. Счётчик не используется. {QUALITY_HINTS.bugsAfterTest}
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="caption">
        Сверка «{diagnostic.fieldName}» со счётчиком QA→Fix из changelog. {QUALITY_HINTS.bugsAfterTest}
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Сравнение</th>
              <th className="num">Задач</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Совпало</td>
              <td className="num">{diagnostic.match}</td>
            </tr>
            <tr>
              <td>Есть в changelog, в поле 0 или пусто</td>
              <td className="num">{diagnostic.changelogOnly}</td>
            </tr>
            <tr>
              <td>Есть в поле, в changelog 0</td>
              <td className="num">{diagnostic.fieldOnly}</td>
            </tr>
            <tr>
              <td>Оба есть, числа разные</td>
              <td className="num">{diagnostic.disagree}</td>
            </tr>
            <tr>
              <td>Поле пустое</td>
              <td className="num">{diagnostic.missingField}</td>
            </tr>
            <tr>
              <td>Сравнено задач с полной историей</td>
              <td className="num">{diagnostic.compared}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
