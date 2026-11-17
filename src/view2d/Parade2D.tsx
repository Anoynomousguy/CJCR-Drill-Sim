import { useEffect, useMemo, useRef, type WheelEvent } from 'react';
import { sampleTimeline } from '../engine/simulate';
import { useStore } from '../state/store';

const SQUAD_COLOURS = ['#6ea8ff', '#7fd4a8', '#e3b56b', '#c694ff', '#7ee0e0', '#ff9f9f'];

export function Parade2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeline = useStore((s) => s.timeline);
  const showTrails = useStore((s) => s.showTrails);
  const showGrid = useStore((s) => s.showGrid);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });

  const trails = useMemo(() => {
    const samples: { x: number; z: number; id: string; squad: number; role: string }[][] = [];
    const steps = 26;
    for (let i = 0; i <= steps; i += 1) {
      const t = (timeline.duration * i) / steps;
      samples.push(
        sampleTimeline(timeline, t).soldiers.map((s) => ({
          x: s.x,
          z: s.z,
          id: s.soldier.id,
          squad: s.soldier.squad,
          role: s.soldier.role,
        })),
      );
    }
    return samples;
  }, [timeline]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const state = useStore.getState();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { squareWidth, squareDepth } = state.plan.settings;
      const view = viewRef.current;
      const pad = 22;
      const base = Math.min((w - pad * 2) / (squareWidth + 2.5), (h - pad * 2) / (squareDepth + 2.5));
      const scale = base * view.zoom;
      const cx = w / 2 + view.panX;
      const cy = h / 2 + view.panY;
      const toPx = (x: number, z: number) => ({ px: cx + x * scale, py: cy - z * scale });

      // background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#12171d');
      bg.addColorStop(1, '#0c1014');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // square
      const a = toPx(-squareWidth / 2, squareDepth / 2);
      const b = toPx(squareWidth / 2, -squareDepth / 2);
      ctx.fillStyle = '#2b3138';
      ctx.fillRect(a.px, a.py, b.px - a.px, b.py - a.py);
      if (showGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let m = 1; m < squareWidth; m += 1) {
          const p1 = toPx(-squareWidth / 2 + m, squareDepth / 2);
          const p2 = toPx(-squareWidth / 2 + m, -squareDepth / 2);
          ctx.beginPath();
          ctx.moveTo(p1.px, p1.py);
          ctx.lineTo(p2.px, p2.py);
          ctx.stroke();
        }
        for (let m = 1; m < squareDepth; m += 1) {
          const p1 = toPx(-squareWidth / 2, squareDepth / 2 - m);
          const p2 = toPx(squareWidth / 2, squareDepth / 2 - m);
          ctx.beginPath();
          ctx.moveTo(p1.px, p1.py);
          ctx.lineTo(p2.px, p2.py);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(235,240,235,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(a.px, a.py, b.px - a.px, b.py - a.py);
      ctx.strokeStyle = 'rgba(235,240,235,0.25)';
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
      ctx.fillStyle = 'rgba(235,240,235,0.35)';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('FRONT', cx - 18, a.py + 16);
      ctx.fillText(`${squareWidth.toFixed(1)} m`, cx - 16, b.py + 18);

      // trails
      if (showTrails) {
        ctx.lineWidth = 1;
        for (const sample of trails) {
          for (const p of sample) {
            const { px, py } = toPx(p.x, p.z);
            ctx.fillStyle =
              p.role === 'commander'
                ? 'rgba(255,205,110,0.5)'
                : p.role === 'colourOfficer' || p.role === 'colourEscort'
                  ? 'rgba(255,142,152,0.5)'
                  : `rgba(150,190,255,0.28)`;
            ctx.fillRect(px - 1, py - 1, 2, 2);
          }
        }
      }

      // soldiers
      const sample = sampleTimeline(timeline, state.t);
      for (const s of sample.soldiers) {
        const { px, py } = toPx(s.x, s.z);
        const role = s.soldier.role;
        const fill =
          role === 'commander'
            ? '#ffcd6e'
            : role === 'colourOfficer'
              ? '#ff8e98'
              : role === 'colourEscort'
                ? '#ffb3a7'
                : role === 'wo'
                  ? '#d7dde6'
                  : SQUAD_COLOURS[s.soldier.squad % SQUAD_COLOURS.length];
        const size = Math.max(4, Math.min(9, scale * 0.42));
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-s.heading);
        ctx.beginPath();
        ctx.moveTo(0, -size * 1.15);
        ctx.lineTo(size * 0.85, size * 0.8);
        ctx.lineTo(0, size * 0.35);
        ctx.lineTo(-size * 0.85, size * 0.8);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = 'rgba(10,14,18,0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        if (role !== 'cadet' && role !== 'marker') {
          ctx.fillStyle = 'rgba(230,238,245,0.75)';
          ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(
            role === 'commander' ? 'COMD' : role === 'wo' ? 'WO' : role === 'colourOfficer' ? 'COLOUR' : 'ESCORT',
            px + 7,
            py - 6,
          );
        }
      }

      // ruler
      const rulerLen = 5 * scale;
      ctx.strokeStyle = 'rgba(235,240,235,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w - 30 - rulerLen, h - 26);
      ctx.lineTo(w - 30, h - 26);
      ctx.moveTo(w - 30 - rulerLen, h - 31);
      ctx.lineTo(w - 30 - rulerLen, h - 21);
      ctx.moveTo(w - 30, h - 31);
      ctx.lineTo(w - 30, h - 21);
      ctx.stroke();
      ctx.fillStyle = 'rgba(235,240,235,0.55)';
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('5 m', w - 30 - rulerLen / 2 - 8, h - 32);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [timeline, trails, showTrails, showGrid]);

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const view = viewRef.current;
    view.zoom = Math.min(4, Math.max(0.45, view.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
  };

  return (
    <div className="stage2d">
      <canvas ref={canvasRef} onWheel={onWheel} />
      <div className="stage2d-tools">
        <button
          onClick={() => {
            viewRef.current = { zoom: 1, panX: 0, panY: 0 };
          }}
        >
          Fit
        </button>
        <span className="stage2d-hint">scroll to zoom</span>
      </div>
    </div>
  );
}
