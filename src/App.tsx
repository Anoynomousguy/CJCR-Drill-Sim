import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { Library } from './ui/Library';
import { Programme } from './ui/Programme';
import { Inspector } from './ui/Inspector';
import { Transport } from './ui/Transport';
import { Stage3D } from './view3d/Stage3D';
import { Parade2D } from './view2d/Parade2D';
import { openPlan, savePlan } from './state/persist';
import { useStore } from './state/store';

export default function App() {
  const plan = useStore((s) => s.plan);
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  const setName = useStore((s) => s.setName);
  const setView = useStore((s) => s.setView);
  const detail = useStore((s) => s.detail);
  const setDetail = useStore((s) => s.setDetail);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.history.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [renaming, setRenaming] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // main clock
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      useStore.getState().tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const state = useStore.getState();
      if (event.code === 'Space') {
        event.preventDefault();
        state.toggle();
      } else if (event.key === 'ArrowRight') {
        state.seek(state.t + (event.shiftKey ? 2 : 0.5));
      } else if (event.key === 'ArrowLeft') {
        state.seek(state.t - (event.shiftKey ? 2 : 0.5));
      } else if (event.key === 'Home') {
        state.seek(0);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selectedId) state.removeMovement(state.selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // native menu bridge
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    return bridge.onMenu((command) => {
      if (command === 'new') useStore.getState().newPlan();
      if (command === 'open') void openPlan();
      if (command === 'save') void savePlan(false);
      if (command === 'save-as') void savePlan(true);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => useStore.getState().notify(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const state = useStore.getState();
    const activeId = String(active.id);
    if (!over) return;
    const overId = String(over.id);
    if (activeId.startsWith('lib:')) {
      const type = activeId.slice(4);
      const index = overId === 'programme' ? undefined : state.plan.programme.findIndex((m) => m.id === overId);
      state.addMovement(type, index === undefined || index < 0 ? undefined : index);
      return;
    }
    const from = state.plan.programme.findIndex((m) => m.id === activeId);
    const to = state.plan.programme.findIndex((m) => m.id === overId);
    if (from >= 0 && to >= 0 && from !== to) state.reorder(from, to);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <div>
            <div className="brand-title">CJCR PARADE</div>
            <div className="brand-sub">Drill programme · 3D &amp; 2D</div>
          </div>
        </div>

        <div className="plan-name">
          {renaming ? (
            <input
              autoFocus
              value={plan.name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(event) => event.key === 'Enter' && setRenaming(false)}
            />
          ) : (
            <button className="plan-name-button" onClick={() => setRenaming(true)} title="Rename programme">
              {plan.name || 'Untitled programme'}
            </button>
          )}
          <span className="muted small">
            {plan.settings.strength} cadets · {plan.settings.squads} squad
            {plan.settings.squads === 1 ? '' : 's'} · {plan.settings.ranks} ranks
          </span>
        </div>

        <div className="top-actions">
          <div className="seg">
            <button onClick={() => useStore.getState().newPlan()}>New</button>
            <button onClick={() => void openPlan()}>Open</button>
            <button onClick={() => void savePlan(false)}>Save</button>
          </div>
          <div className="seg icon-seg">
            <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
              ↶
            </button>
            <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
              ↷
            </button>
          </div>
          <div className="seg view-seg">
            <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>
              3D
            </button>
            <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')}>
              Split
            </button>
            <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>
              2D
            </button>
          </div>
          <div className="seg">
            <button
              className={detail === 'high' ? 'on' : ''}
              onClick={() => setDetail(detail === 'high' ? 'low' : 'high')}
              title="Model detail"
            >
              {detail === 'high' ? 'Detail high' : 'Detail low'}
            </button>
          </div>
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <main className="main">
          <Library />
          <Programme />
          <section className={`stage ${view}`}>
            {view !== '2d' && <Stage3D />}
            {view === 'split' && <div className="splitter" />}
            {view !== '3d' && <Parade2D />}
            <StageCaption />
          </section>
          <Inspector />
        </main>
      </DndContext>

      <Transport />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function StageCaption() {
  const t = useStore((s) => s.t);
  const timeline = useStore((s) => s.timeline);
  const playing = useStore((s) => s.playing);
  let index = timeline.segments.length - 1;
  for (let i = 0; i < timeline.segments.length; i += 1) {
    if (t <= timeline.segments[i].end) {
      index = i;
      break;
    }
  }
  const segment = timeline.segments[index];
  if (!segment) return null;
  return (
    <div className="stage-caption">
      <span className="caption-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="caption-words">{segment.words}</span>
      <span className="caption-title">{segment.title}</span>
      {!playing && <span className="caption-hint">space to play</span>}
    </div>
  );
}
