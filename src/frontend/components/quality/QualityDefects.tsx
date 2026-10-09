import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
import type { QualityDefects } from '@backend/metrics/quality-defects';

export function QualityDefectsPanel({ defects }: { defects: QualityDefects }) {
  const proven = defects.items.filter((item) => item.kind === 'production' || item.kind === 'incident');
  const unproven = defects.items.filter((item) => item.kind === 'unproven');
  if (defects.created === 0) {
    return <p className="caption">В окне спринта нет багов или инцидентов вне когорты First QA.</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="caption">
        {defects.production + defects.incidents} с признаком production/инцидент · {defects.unproven} без признака.{' '}
        {QUALITY_HINTS.defects}
      </p>
      {proven.length > 0 && (
        <DefectTable title="Production / инциденты" items={proven} />
      )}
      {unproven.length > 0 && (
        <DefectTable title="Созданы в окне, признак production не доказан" items={unproven} />
      )}
    </div>
  );
}

function DefectTable({
  title,
  items,
}: {
  title: string;
  items: QualityDefects['items'];
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="caption">{title}</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ключ</th>
              <th>Название</th>
              <th>Тип</th>
              <th>Создан</th>
              <th>Признак</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.key}
                  </a>
                </td>
                <td>{item.summary}</td>
                <td>{item.type}</td>
                <td>{item.created.slice(0, 10)}</td>
                <td>{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
