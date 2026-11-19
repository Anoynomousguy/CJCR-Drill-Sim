import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import { LEG } from './gait';
import { buildTimeline, sampleTimeline } from './simulate';
import {
  makeTurnPlan,
  turnBodyAt,
  turnFootContact,
  turnFootwork,
  turnHeadingAt,
} from './turn';
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
    // Five beats: half pace and the right foot in, then one 90 for each ball
    // pivot, then the step off.
    expect(turnHeadingAt(about, 0.4)).toBe(0);
    expect(turnHeadingAt(about, 0.6)).toBeCloseTo(0.5, 6);
    expect(turnHeadingAt(about, 0.8)).toBeCloseTo(1, 6);
    expect(turnHeadingAt(about, 1)).toBe(1);
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
    // The halt turn is body erect: no chest lead is layered on the pivot.
    expect(pivot.headYaw).toBe(0);
    expect(pivot.chestYaw).toBe(0);

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
    expect(pivot.chestYaw).toBe(0);
  });

  it('fixes the right heel and left ball in the world through the pivot', () => {
    for (const [degrees, dir] of [
      [90, 'right'],
      [90, 'left'],
      [180, 'right'],
      [45, 'right'],
    ] as const) {
      const plan = makeTurnPlan('halt', degrees, dir);
      const start = turnBodyAt(plan, 0)!;
      const heel = turnFootContact(start, 0, plan.pivot, 'heel');
      const ball = turnFootContact(start, 0, plan.outside, 'ball');
      expect(heel.y).toBeCloseTo(0, 6);
      expect(ball.y).toBeCloseTo(0, 6);
      const pivotEnd = plan.phases.find((p) => p.key === 'pivot')!.end;
      for (const p of [0.05, 0.15, 0.28, 0.4, pivotEnd - 0.01]) {
        const body = turnBodyAt(plan, p)!;
        const rel = ((plan.angle * 180) / Math.PI) * turnHeadingAt(plan, p);
        const h = turnFootContact(body, rel, plan.pivot, 'heel');
        const b = turnFootContact(body, rel, plan.outside, 'ball');
        expect(Math.hypot(h.x - heel.x, h.z - heel.z), `${dir}${degrees} heel ${p}`).toBeLessThan(1e-6);
        expect(Math.hypot(b.x - ball.x, b.z - ball.z), `${dir}${degrees} ball ${p}`).toBeLessThan(1e-6);
        // Both feet are still carrying the pivot: neither boot is a skate.
        expect(body.left.planted && body.right.planted, `${dir}${degrees} ${p}`).toBe(true);
        expect(body.hipY).toBeLessThanOrEqual(0.94);
      }
    }
  });

  it('closes the outside boot and leaves the pivot contact fixed', () => {
    const plan = makeTurnPlan('halt', 90, 'right');
    const start = turnBodyAt(plan, 0)!;
    const heel = turnFootContact(start, 0, 'R', 'heel');
    const relEnd = (plan.angle * 180) / Math.PI;
    const middle = turnBodyAt(plan, 0.85)!;
    expect(middle.left.planted).toBe(false);
    expect(Math.abs(turnFootContact(middle, relEnd, 'R', 'heel').x - heel.x)).toBeLessThan(1e-6);
    expect(Math.abs(turnFootContact(middle, relEnd, 'R', 'heel').z - heel.z)).toBeLessThan(1e-6);

    const done = turnBodyAt(plan, 1)!;
    expect(done.left.planted && done.right.planted).toBe(true);
    expect(done.left.x).toBeCloseTo(LEG.standX, 6);
    expect(done.right.x).toBeCloseTo(-LEG.standX, 6);
    expect(done.left.z).toBeCloseTo(0, 6);
    expect(done.right.z).toBeCloseTo(0, 6);
    expect(done.left.pitch).toBeCloseTo(0, 6);
    expect(done.right.pitch).toBeCloseTo(0, 6);
    expect(Math.abs(turnFootContact(done, relEnd, 'R', 'heel').x - heel.x)).toBeLessThan(1e-6);
    expect(Math.abs(turnFootContact(done, relEnd, 'R', 'heel').z - heel.z)).toBeLessThan(1e-6);
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
    // The first ball is taken on the third beat, once the right boot has come
    // in beside the left; the second ball follows on the fourth beat.
    const first = turnFootwork(plan, 0.5);
    expect(first.right.pitch).toBeGreaterThan(2);
    expect(first.left.planted).toBe(false);
    expect(first.left.lift).toBeGreaterThan(0.05);

    const second = turnFootwork(plan, 0.7);
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

    // A real heel/toe pivot moves the body centre a few centimetres; what must
    // not happen is the whole formation orbiting the frame origin.
    for (let i = 0; i < start.soldiers.length; i += 1) {
      expect(distance(start.soldiers[i], mid.soldiers[i]), `cadet ${i} mid`).toBeLessThan(0.12);
      expect(distance(start.soldiers[i], end.soldiers[i]), `cadet ${i} end`).toBeLessThan(0.15);
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

  it('handles the left turn and the 180 about turn without orbiting the slots', () => {
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
        expect(distance(start.soldiers[i], end.soldiers[i]), `${type} cadet ${i}`).toBeLessThan(0.3);
      }
      const turned = Math.abs(end.soldiers[0].heading - start.soldiers[0].heading) * (180 / Math.PI);
      expect(Math.abs(turned - expected)).toBeLessThan(0.01);
    }
  });

  it('carries the stride and arm swing through a marching seam without a frozen pause', () => {
    const timeline = timelineOf([
      move('quickMarch', { paces: 4 }),
      move('rightTurnOnMarch'),
      move('quickMarch', { paces: 4 }),
    ]);
    const first = timeline.segments.find((s) => s.type === 'quickMarch')!;
    const turn = timeline.segments.find((s) => s.type === 'rightTurnOnMarch')!;
    // The squad is still marching: the command does not add a standing pause.
    expect(first.end).toBeCloseTo(first.actionEnd, 6);
    expect(turn.end).toBeCloseTo(turn.actionEnd, 6);

    // The turn itself cuts the arms for the pivot; the seam that used to freeze
    // is the end of the turn running into the next marching command.
    const before = sampleTimeline(timeline, turn.actionEnd - 0.01);
    // Half a beat after the command: the first step is a full beat long, so
    // this is the point by which the stride must visibly be running again.
    const after = sampleTimeline(timeline, turn.actionEnd + 0.25);
    expect(before.soldiers[0].gait).toBe('quick');
    expect(after.soldiers[0].gait).toBe('quick');
    expect(after.soldiers[0].stride - before.soldiers[0].stride).toBeGreaterThan(0.2);
    expect(before.soldiers[0].stride).toBeGreaterThan(0);
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
