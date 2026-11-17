import { useRef } from 'react';
import { getMoveDef } from '../engine/movements';
import { useStore } from '../state/store';

const DISCIPLINE_COLOUR: Record<string, string> = {
  foot: '#3f6ea8',
  rifle: '#8a6a38',
  colour: '#9c4450',
  ceremonial: '#5d6b7a',
};

export function Transport() {
  const timeline = useStore((s) => s.timeline);
  const t = useStore((s) => s.t);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const loop = useStore((s) => s.loop);
  const toggle = useStore((s) => s.toggle);
  const seek = useStore((s) => s.seek);
  const setSpeed = useStore((s) => s.setSpeed);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const barRef = useRef<HTMLDivElement>(null);

  const duration = Math.max(0.001, timeline.duration);
  const progress = Math.min(1, t / duration);

  const scrubTo = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  return (
    <footer className="transport">
      <div className="transport-row">
        <div className="transport-controls">
          <button className="play" onClick={toggle} title="Space">
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="step" onClick={() => seek(t - 0.5)} title="Back half a second">
            −
          </button>
          <button className="step" onClick={() => seek(t + 0.5)} title="Forward half a second">
            +
          </button>
          <span className="clock">
            {format(t)} <em>/ {format(duration)}</em>
          </span>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} title="Playback speed">
            {[0.25, 0.5, 1, 1.5, 2].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button className={`ghost small${loop ? ' on' : ''}`} onClick={toggleLoop}>
            Loop
          </button>
        </div>
        <div className="transport-note">
          Standard pause 2 beats · 120 paces/min · 75 cm pace
        </div>
      </div>
      <div
        className="timeline"
        ref={barRef}
        onPointerDown={(event) => {
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          scrubTo(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) scrubTo(event.clientX);
        }}
      >
        {timeline.segments.map((segment) => {
          const def = segment.type === 'idle' ? null : getMoveDef(segment.type);
          const left = (segment.start / duration) * 100;
          const width = ((segment.actionEnd - segment.start) / duration) * 100;
          const pause = ((segment.end - segment.actionEnd) / duration) * 100;
          return (
            <div key={segment.index}>
              <div
                className="tl-block"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: def ? DISCIPLINE_COLOUR[def.discipline] ?? '#42566b' : '#2c3742',
                  outline: selectedId === segment.moveId ? '1px solid rgba(255,255,255,.65)' : 'none',
                }}
                title={`${segment.index + 1}. ${segment.title} — ${segment.words}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  select(segment.moveId);
                  seek(segment.start);
                }}
              >
                <span>{segment.index + 1}</span>
              </div>
              {pause > 0.1 && (
                <div className="tl-pause" style={{ left: `${left + width}%`, width: `${pause}%` }} />
              )}
            </div>
          );
        })}
        <div className="tl-playhead" style={{ left: `${progress * 100}%` }} />
      </div>
    </footer>
  );
}

function format(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}
