import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { describeParams, getMoveDef } from '../engine/movements';
import type { MovementInstance } from '../engine/types';
import { useStore } from '../state/store';

export function Programme() {
  const programme = useStore((s) => s.plan.programme);
  const timeline = useStore((s) => s.timeline);
  const selectedId = useStore((s) => s.selectedId);
  const seek = useStore((s) => s.seek);
  const ids = useMemo(() => programme.map((m) => m.id), [programme]);
  const { setNodeRef, isOver } = useDroppable({ id: 'programme' });

  return (
    <section className="panel programme">
      <div className="panel-head">
        <h2>Programme</h2>
        <span className="muted small">
          {programme.length} movement{programme.length === 1 ? '' : 's'} · {formatTime(timeline.duration)}
        </span>
      </div>
      <div ref={setNodeRef} className={`programme-list${isOver ? ' over' : ''}`}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {programme.map((move, index) => {
            const segment = timeline.segments[index];
            const duration = segment ? segment.actionEnd - segment.start : 0;
            const warnings = timeline.warnings.filter((w) => w.moveIndex === index && w.severity !== 'info');
            return (
              <MovementCard
                key={move.id}
                move={move}
                index={index}
                duration={duration}
                warnings={warnings.length}
                selected={selectedId === move.id}
                onSelect={() => {
                  useStore.getState().select(move.id);
                  if (segment) seek(segment.start);
                }}
              />
            );
          })}
        </SortableContext>
        {!programme.length && (
          <div className="empty">
            <p>Nothing on parade yet.</p>
            <p className="muted small">Drag a movement here from the library to begin the programme.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function MovementCard({
  move,
  index,
  duration,
  warnings,
  selected,
  onSelect,
}: {
  move: MovementInstance;
  index: number;
  duration: number;
  warnings: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: move.id });
  const def = getMoveDef(move.type);
  const updateParams = useStore((s) => s.updateParams);
  const remove = useStore((s) => s.removeMovement);
  const duplicate = useStore((s) => s.duplicateMovement);
  const [expanded, setExpanded] = useState(false);
  const open = selected || expanded;

  return (
    <div
      ref={setNodeRef}
      className={`move-card${selected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      data-discipline={def.discipline}
    >
      <div className="move-row">
        <button className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          ⋮⋮
        </button>
        <span className="move-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="move-titles">
          <span className="move-title">{def.title}</span>
          <span className="move-words">{def.words}</span>
        </div>
        <span className="move-duration">{duration.toFixed(1)}s</span>
        {warnings > 0 && <span className="badge warn" title="Validation warnings">!</span>}
        <button
          className="icon-btn"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <div className="move-body" onClick={(event) => event.stopPropagation()}>
          <div className="move-params">
            {describeParams(move.type, move.params) && (
              <span className="param-summary">{describeParams(move.type, move.params)}</span>
            )}
            {(def.params ?? []).map((param) => (
              <label key={param.key} className="param">
                <span>{param.label}</span>
                {param.type === 'number' ? (
                  <input
                    type="number"
                    min={param.min}
                    max={param.max}
                    step={param.step ?? 1}
                    value={Number(move.params[param.key] ?? def.defaults?.[param.key] ?? 0)}
                    onChange={(event) =>
                      updateParams(move.id, { [param.key]: Number(event.target.value) })
                    }
                  />
                ) : (
                  <select
                    value={String(move.params[param.key] ?? def.defaults?.[param.key] ?? '')}
                    onChange={(event) => updateParams(move.id, { [param.key]: event.target.value })}
                  >
                    {param.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
            <span className="param-ref">{def.reference}</span>
          </div>
          <p className="move-help">{def.help}</p>
          <div className="move-actions">
            <button className="ghost" onClick={() => duplicate(move.id)}>
              Duplicate
            </button>
            <button className="ghost danger" onClick={() => remove(move.id)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}
