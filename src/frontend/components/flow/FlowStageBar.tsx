import { useI18n } from '@frontend/i18n/locale';
import { SegmentBar } from '@frontend/components/charts';
import { FLOW_STAGE_TONE } from '@backend/metrics/flow-stage-tone';
import type { FlowSnapshot } from '@backend/metrics/flow-model';
import { uiLabel } from '@shared/locale';
import type { FlowStageId } from '@shared/types';

export function FlowStageBar({
  flow,
  selected,
  onSelect,
}: {
  flow: FlowSnapshot;
  selected?: FlowStageId | string;
  onSelect: (stage: FlowStageId) => void;
}) {
  const { t } = useI18n();
  if (flow.stages.length === 0) {
    return <p className="caption">{t('Nothing is in Development WIP right now', 'Сейчас в Development WIP ничего нет')}</p>;
  }
  return (
    <SegmentBar
      segments={flow.stages.map((stage) => ({
        id: stage.id,
        label: uiLabel(stage.label),
        value: stage.count,
        tone: FLOW_STAGE_TONE[stage.id] ?? 'neutral',
      }))}
      selected={typeof selected === 'string' ? selected : undefined}
      onSelect={(id) => onSelect(id as FlowStageId)}
    />
  );
}
