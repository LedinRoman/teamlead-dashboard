import { SegmentBar } from '@frontend/components/charts';
import { FLOW_STAGE_TONE } from '@backend/metrics/flow-stage-tone';
import type { FlowSnapshot } from '@backend/metrics/flow-model';
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
  if (flow.stages.length === 0) {
    return <p className="caption">Nothing is in Development WIP right now</p>;
  }
  return (
    <SegmentBar
      segments={flow.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        value: stage.count,
        tone: FLOW_STAGE_TONE[stage.id] ?? 'neutral',
      }))}
      selected={typeof selected === 'string' ? selected : undefined}
      onSelect={(id) => onSelect(id as FlowStageId)}
    />
  );
}
