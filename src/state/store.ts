import { create } from 'zustand';
import type { BodyMode } from '../engine/anatomy';
import { DEFAULT_SETTINGS } from '../engine/constants';
import { defaultParams } from '../engine/movements';
import { buildTimeline, type Timeline } from '../engine/simulate';
import type { MovementInstance, Plan, PlanSettings, RosterEntry } from '../engine/types';
import { clamp, normalish, round2, seeded, uid } from '../engine/util';

const STORAGE_KEY = 'cjcr-parade-plan-v2';

export function makeRoster(settings: PlanSettings, existing: RosterEntry[] = []): RosterEntry[] {
  const rnd = seeded(settings.heightSeed + existing.length);
  const out = existing.slice(0, settings.strength).map((r) => ({ ...r }));
  while (out.length < settings.strength) {
    out.push({
      id: uid('cadet'),
      height: round2(clamp(normalish(rnd, 1.77, 0.22), 1.56, 1.95)),
    });
  }
  return out;
}

function demoProgramme(): MovementInstance[] {
  const build = (type: string, params?: Record<string, number | string>): MovementInstance => ({
    id: uid('move'),
    type,
    params: { ...defaultParams(type), ...(params ?? {}) },
  });
  return [
    build('attention'),
    build('rightDress'),
    build('eyesFront'),
    build('slopeArms'),
    build('quickMarch', { paces: 10 }),
    build('rightTurnOnMarch'),
    build('halt'),
    build('presentArms'),
    build('carryColour'),
    build('dipColour'),
    build('carryFromDip'),
    build('orderColour'),
    build('slopeFromPresent'),
    build('aboutTurn'),
    build('quickMarch', { paces: 8 }),
    build('halt'),
    build('orderArms'),
  ];
}

export function makePlan(): Plan {
  const settings: PlanSettings = { ...DEFAULT_SETTINGS };
  return {
    version: 1,
    name: 'Advance in review order',
    settings,
    roster: makeRoster(settings),
    programme: demoProgramme(),
  };
}

function loadLocal(): Plan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Plan;
    if (!parsed?.settings || !Array.isArray(parsed.programme)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface AppState {
  plan: Plan;
  timeline: Timeline;
  filePath: string | null;
  savedSnapshot: string;
  selectedId: string | null;
  view: '3d' | '2d' | 'split';
  t: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  showTrails: boolean;
  showGrid: boolean;
  detail: 'low' | 'high';
  body: BodyMode;
  history: Plan[];
  future: Plan[];
  toast: string | null;

  setSettings: (patch: Partial<PlanSettings>) => void;
  setStrength: (n: number) => void;
  regenerateHeights: () => void;
  setHeight: (id: string, height: number) => void;
  addMovement: (type: string, index?: number) => void;
  removeMovement: (id: string) => void;
  duplicateMovement: (id: string) => void;
  reorder: (from: number, to: number) => void;
  updateParams: (id: string, patch: Record<string, number | string>) => void;
  select: (id: string | null) => void;
  setName: (name: string) => void;

  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  tick: (dt: number) => void;
  setSpeed: (s: number) => void;
  toggleLoop: () => void;
  setView: (v: '3d' | '2d' | 'split') => void;
  toggleTrails: () => void;
  toggleGrid: () => void;
  setDetail: (d: 'low' | 'high') => void;
  setBody: (b: BodyMode) => void;

  newPlan: () => void;
  loadPlan: (plan: Plan, path?: string | null) => void;
  markSaved: (path: string | null) => void;
  undo: () => void;
  redo: () => void;
  notify: (message: string | null) => void;
}

const initialPlan = (typeof localStorage !== 'undefined' && loadLocal()) || makePlan();

function commit(
  state: AppState,
  plan: Plan,
  extra: Partial<AppState> = {},
): Partial<AppState> {
  return {
    plan,
    timeline: buildTimeline(plan),
    history: [...state.history.slice(-40), state.plan],
    future: [],
    ...extra,
  };
}

export const useStore = create<AppState>((set, get) => ({
  plan: initialPlan,
  timeline: buildTimeline(initialPlan),
  filePath: null,
  savedSnapshot: JSON.stringify(initialPlan),
  selectedId: initialPlan.programme[0]?.id ?? null,
  view: 'split',
  t: 0,
  playing: false,
  speed: 1,
  loop: false,
  showTrails: true,
  showGrid: true,
  detail: 'high',
  body: 'uniform',
  history: [],
  future: [],
  toast: null,

  setSettings: (patch) =>
    set((state) => {
      const settings = { ...state.plan.settings, ...patch };
      let roster = state.plan.roster;
      if (patch.strength !== undefined) {
        roster = makeRoster(settings, roster);
      }
      const plan = { ...state.plan, settings, roster };
      const t = Math.min(state.t, buildTimeline(plan).duration);
      return { ...commit(state, plan), t };
    }),

  setStrength: (n) => get().setSettings({ strength: clamp(Math.round(n), 1, 120) }),

  regenerateHeights: () =>
    set((state) => {
      const settings = { ...state.plan.settings, heightSeed: Math.floor(Math.random() * 100000) };
      const plan = { ...state.plan, settings, roster: makeRoster(settings, []) };
      return commit(state, plan);
    }),

  setHeight: (id, height) =>
    set((state) => {
      const roster = state.plan.roster.map((r) =>
        r.id === id ? { ...r, height: clamp(round2(height), 1.4, 2.05) } : r,
      );
      return commit(state, { ...state.plan, roster });
    }),

  addMovement: (type, index) =>
    set((state) => {
      const instance: MovementInstance = { id: uid('move'), type, params: defaultParams(type) };
      const programme = [...state.plan.programme];
      const at = index === undefined ? programme.length : clamp(index, 0, programme.length);
      programme.splice(at, 0, instance);
      const next = commit(state, { ...state.plan, programme }, { selectedId: instance.id });
      return next;
    }),

  removeMovement: (id) =>
    set((state) => {
      const programme = state.plan.programme.filter((m) => m.id !== id);
      return commit(state, { ...state.plan, programme }, {
        selectedId: state.selectedId === id ? null : state.selectedId,
      });
    }),

  duplicateMovement: (id) =>
    set((state) => {
      const index = state.plan.programme.findIndex((m) => m.id === id);
      if (index < 0) return {};
      const source = state.plan.programme[index];
      const copy: MovementInstance = { ...source, id: uid('move'), params: { ...source.params } };
      const programme = [...state.plan.programme];
      programme.splice(index + 1, 0, copy);
      return commit(state, { ...state.plan, programme }, { selectedId: copy.id });
    }),

  reorder: (from, to) =>
    set((state) => {
      const programme = [...state.plan.programme];
      if (from < 0 || from >= programme.length) return {};
      const [item] = programme.splice(from, 1);
      programme.splice(clamp(to, 0, programme.length), 0, item);
      return commit(state, { ...state.plan, programme });
    }),

  updateParams: (id, patch) =>
    set((state) => {
      const programme = state.plan.programme.map((m) =>
        m.id === id ? { ...m, params: { ...m.params, ...patch } } : m,
      );
      return commit(state, { ...state.plan, programme });
    }),

  select: (id) => set({ selectedId: id }),
  setName: (name) => set((state) => ({ plan: { ...state.plan, name } })),

  play: () =>
    set((state) => ({
      playing: true,
      t: state.t >= state.timeline.duration - 0.02 ? 0 : state.t,
    })),
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => set((state) => ({ t: clamp(t, 0, state.timeline.duration) })),
  tick: (dt) =>
    set((state) => {
      if (!state.playing) return {};
      const next = state.t + dt * state.speed;
      if (next >= state.timeline.duration) {
        if (state.loop) return { t: 0 };
        return { t: state.timeline.duration, playing: false };
      }
      return { t: next };
    }),
  setSpeed: (speed) => set({ speed }),
  toggleLoop: () => set((state) => ({ loop: !state.loop })),
  setView: (view) => set({ view }),
  toggleTrails: () => set((state) => ({ showTrails: !state.showTrails })),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setDetail: (detail) => set({ detail }),
  setBody: (body) => set({ body }),

  newPlan: () =>
    set((state) => {
      const plan = makePlan();
      return {
        ...commit(state, plan, { selectedId: plan.programme[0]?.id ?? null }),
        filePath: null,
        t: 0,
        playing: false,
      };
    }),

  loadPlan: (plan, path = null) =>
    set((state) => ({
      ...commit(state, plan, { selectedId: plan.programme[0]?.id ?? null }),
      filePath: path,
      savedSnapshot: JSON.stringify(plan),
      t: 0,
      playing: false,
    })),

  markSaved: (path) => set((state) => ({ filePath: path, savedSnapshot: JSON.stringify(state.plan) })),

  undo: () =>
    set((state) => {
      if (!state.history.length) return {};
      const previous = state.history[state.history.length - 1];
      return {
        plan: previous,
        timeline: buildTimeline(previous),
        history: state.history.slice(0, -1),
        future: [state.plan, ...state.future].slice(0, 40),
        t: Math.min(state.t, buildTimeline(previous).duration),
      };
    }),

  redo: () =>
    set((state) => {
      if (!state.future.length) return {};
      const next = state.future[0];
      return {
        plan: next,
        timeline: buildTimeline(next),
        history: [...state.history, state.plan],
        future: state.future.slice(1),
        t: Math.min(state.t, buildTimeline(next).duration),
      };
    }),

  notify: (toast) => set({ toast }),
}));

declare global {
  interface Window {
    __cjcrStore?: typeof useStore;
  }
}

if (typeof window !== 'undefined' && import.meta.env.DEV) window.__cjcrStore = useStore;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useStore.subscribe((state) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plan));
    } catch {
      /* ignore quota errors */
    }
  }, 400);
});
