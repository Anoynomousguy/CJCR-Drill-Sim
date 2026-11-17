import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import { LEG } from './gait';
import { buildTimeline, sampleTimeline } from './simulate';
import { makeTurnPlan, turnFootwork, turnHeadingAt } from './turn';
import type { Plan } from './types';

const settings = {
  ...DEFAULT_SETTINGS,
  strength: 6,
  squads: 1,
  ranks: 2,
  colours: 0,
  commander: false,
  supernumerary: false,
  armed: false,
  uniform: 'army',
  headingDeg: 0,
} satisfies Plan['settings'];

function timelineOf(programme: Plan['programme']) {
  const plan: Plan = {
    version: 1,
    name: 'turn test',
    settings,
    roster: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, height: 1.72 + i * 0.02 })),
    programme,
  };
  return buildTimeline(plan);
}

const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: type,
  type,
  params,
});

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('turn plans', () => {
  it('builds a right turn from the command, not from a positive angle', () => {
    const plan = makeTurnPlan('halt', 90, 'right');
    expect(plan.pivot).toBe('R');
    expect(plan.outside).toBe('L');
    expect(plan.angle).toBeLessThan(0);
    expect(plan.phases.map((p) => p.key)).toEqual(['pivot', 'close']);
    expect(turnHeadingAt(plan, 0)).toBe(0);
    expect(turnHeadingAt(plan, 0.56)).toBe(1);
    expect(turnHeadingAt(plan, 0.64)).toBe(1);
    expect(turnHeadingAt(plan, 1)).toBe(1);
  });

  it('mirrors the left turn and splits the about turn into two pivots', () => {
    const left = makeTurnPlan('halt', 90, 'left');
    expect(left.pivot).toBe('L');
    expect(left.angle).toBeGreaterThan(0);

    const about = makeTurnPlan('aboutMarch', 180, 'right');
    expect(about.phases.map((p) => p.key)).toEqual(['check', 'pivot1', 'pivot2', 'step']);
    expect(turnHeadingAt(about, 0.46)).toBeCloseTo(0.5, 6);
    expect(turnHeadingAt(about, 0.72)).toBeCloseTo(1, 6);
  });
});

describe('turn footwork', () => {
  it('pivots on the right heel and left toe, then closes the left foot', () => {
    const plan = makeTurnPlan('halt', 90, 'right');
    const pivot = turnFootwork(plan, 0.2);
    expect(pivot.right.pitch).toBeLessThan(-2);
    expect(pivot.right.planted).toBe(true);
    expect(pivot.left.pitch).toBeGreaterThan(2);
    expect(pivot.left.planted).toBe(true);
    expect(pivot.left.lift).toBeGreaterThan(0.01);
    expect(pivot.headYaw).toBeGreaterThan(pivot.chestYaw);
    expect(pivot.chestYaw).toBeGreaterThan(0);

    const close = turnFootwork(plan, 0.84);
    expect(close.left.planted).toBe(false);
    expect(close.left.lift).toBeGreaterThan(0.02);

    const done = turnFootwork(plan, 1);
    expect(done.left.planted && done.right.planted).toBe(true);
    expect(done.left.pitch).toBeCloseTo(0, 6);
    expect(done.right.pitch).toBeCloseTo(0, 6);
  });

  it('keeps the pivot heel and the outside ball in contact with the ground', () => {
    for (const dir of ['right', 'left'] as const) {
      const plan = makeTurnPlan('halt', 90, dir);
      for (const p of [0.12, 0.2, 0.35, 0.5]) {
        const fw = turnFootwork(plan, p);
        const pivot = plan.pivot === 'R' ? fw.right : fw.left;
        const outside = plan.pivot === 'R' ? fw.left : fw.right;
        expect(pivot.contact, `${dir} ${p} pivot contact`).toBe('heel');
        expect(outside.contact, `${dir} ${p} outside contact`).toBe('ball');
        expect(pivot.planted && outside.planted, `${dir} ${p} planted`).toBe(true);
        // The ankle lift is exactly what the contact geometry requires: the
        // heel lever for the pivot, the ball lever for the outside foot.
        expect(pivot.lift).toBeCloseTo(LEG.heelLever * Math.sin((-pivot.pitch * Math.PI) / 180), 6);
        expect(outside.lift).toBeCloseTo(LEG.ballLever * Math.sin((outside.pitch * Math.PI) / 180), 6);
      }
    }
  });

  it('never leaves both feet off the ground through a halt turn', () => {
    for (const dir of ['right', 'left'] as const) {
      const plan = makeTurnPlan('halt', 90, dir);
      for (let p = 0; p <= 1.0001; p += 0.01) {
        const fw = turnFootwork(plan, p);
        expect(fw.left.planted || fw.right.planted, `${dir} at ${p.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('mirrors the pivot foot on a left turn', () => {
    const plan = makeTurnPlan('halt', 90, 'left');
    const pivot = turnFootwork(plan, 0.2);
    expect(pivot.left.pitch).toBeLessThan(-2);
    expect(pivot.right.pitch).toBeGreaterThan(2);
    expect(pivot.chestYaw).toBeLessThan(0);
  });

  it('checks, pivots on the inside ball and cuts the arms on a march', () => {
    const plan = makeTurnPlan('march', 90, 'right');
    const check = turnFootwork(plan, 0.1);
    expect(check.armCut).toBe(0);
    expect(check.left.lift).toBeCloseTo(0, 6);

    const pivot = turnFootwork(plan, 0.48);
    expect(pivot.phase).toBe('pivot');
    expect(pivot.right.pitch).toBeGreaterThan(2);
    expect(pivot.right.planted).toBe(true);
    expect(pivot.left.planted).toBe(false);
    expect(pivot.left.lift).toBeGreaterThan(0.05);
    expect(pivot.armCut).toBeGreaterThan(0.8);
  });

  it('pivots on alternate feet for an about turn on the march', () => {
    const plan = makeTurnPlan('aboutMarch', 180, 'right');
    const first = turnFootwork(plan, 0.34);
    expect(first.right.pitch).toBeGreaterThan(2);
    expect(first.left.planted).toBe(false);
    expect(first.left.lift).toBeGreaterThan(0.05);

    const second = turnFootwork(plan, 0.6);
    expect(second.left.pitch).toBeGreaterThan(2);
    expect(second.right.planted).toBe(false);
    expect(second.right.lift).toBeGreaterThan(0.05);
  });
});

describe('parade turns', () => {
  it('turns every cadet in place instead of orbiting the formation', () => {
    const timeline = timelineOf([
      move('attention'),
      move('rightTurn'),
      move('quickMarch', { paces: 4 }),
    ]);
    const seg = timeline.segments.find((s) => s.type === 'rightTurn');
    expect(seg).toBeTruthy();
    if (!seg) return;
    expect(seg.turn?.context).toBe('halt');
    expect(seg.turn?.dir).toBe('right');

    const start = sampleTimeline(timeline, seg.start + 0.001);
    const mid = sampleTimeline(timeline, seg.start + (seg.actionEnd - seg.start) * 0.5);
    const end = sampleTimeline(timeline, seg.actionEnd - 0.001);
    const startHeading = start.soldiers[0].heading;

    for (let i = 0; i < start.soldiers.length; i += 1) {
      expect(distance(start.soldiers[i], mid.soldiers[i]), `cadet ${i} mid`).toBeLessThan(1e-6);
      expect(distance(start.soldiers[i], end.soldiers[i]), `cadet ${i} end`).toBeLessThan(1e-6);
    }
    expect(Math.abs(mid.soldiers[0].heading - startHeading)).toBeGreaterThan(0.1);
    expect(Math.abs(mid.soldiers[0].heading - end.soldiers[0].heading)).toBeGreaterThan(0.001);
    expect(Math.abs(end.soldiers[0].heading - startHeading - (seg.turn?.angle ?? 0))).toBeLessThan(1e-3);
    expect(mid.turn?.plan.dir).toBe('right');

    // The next march must be in the new direction, not the old one.
    const march = timeline.segments.find((s) => s.type === 'quickMarch');
    expect(march).toBeTruthy();
    if (!march) return;
    const after = sampleTimeline(timeline, march.actionEnd - 0.001);
    const heading = end.soldiers[0].heading;
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    for (let i = 0; i < end.soldiers.length; i += 1) {
      const dx = after.soldiers[i].x - end.soldiers[i].x;
      const dz = after.soldiers[i].z - end.soldiers[i].z;
      expect(dx * forward.x + dz * forward.z).toBeGreaterThan(0.5);
    }
  });

  it('handles the left turn and the 180 about turn without moving the slots', () => {
    for (const [type, expected] of [
      ['leftTurn', 90],
      ['aboutTurn', 180],
    ] as const) {
      const timeline = timelineOf([move('attention'), move(type)]);
      const seg = timeline.segments.find((s) => s.type === type);
      expect(seg, type).toBeTruthy();
      if (!seg) continue;
      const start = sampleTimeline(timeline, seg.start + 0.001);
      const end = sampleTimeline(timeline, seg.actionEnd - 0.001);
      for (let i = 0; i < start.soldiers.length; i += 1) {
        expect(distance(start.soldiers[i], end.soldiers[i]), `${type} cadet ${i}`).toBeLessThan(1e-6);
      }
      const turned = Math.abs(end.soldiers[0].heading - start.soldiers[0].heading) * (180 / Math.PI);
      expect(Math.abs(turned - expected)).toBeLessThan(0.01);
    }
  });

  it('arcs the formation through a turn on the march without snapping the heading', () => {
    const timeline = timelineOf([
      move('quickMarch', { paces: 4 }),
      move('rightTurnOnMarch'),
      move('quickMarch', { paces: 4 }),
    ]);
    const seg = timeline.segments.find((s) => s.type === 'rightTurnOnMarch');
    expect(seg).toBeTruthy();
    if (!seg) return;
    expect(seg.turn?.context).toBe('march');
    const start = sampleTimeline(timeline, seg.start + 0.001);
    const mid = sampleTimeline(timeline, seg.start + (seg.actionEnd - seg.start) * 0.5);
    const end = sampleTimeline(timeline, seg.actionEnd - 0.001);
    const h0 = start.soldiers[0].heading;
    const h2 = end.soldiers[0].heading;
    expect(Math.abs(mid.soldiers[0].heading - h0)).toBeGreaterThan(0.05);
    expect(Math.abs(mid.soldiers[0].heading - h2)).toBeGreaterThan(0.05);
    expect(distance(start.soldiers[0], mid.soldiers[0])).toBeGreaterThan(0.05);
    expect(h2 - h0).toBeCloseTo(seg.turn?.angle ?? 0, 6);
  });
});
