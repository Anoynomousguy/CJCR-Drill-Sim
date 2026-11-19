import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import { buildTimeline, sampleTimeline } from './simulate';
import type { Plan } from './types';

const settings = {
  ...DEFAULT_SETTINGS,
  strength: 18,
  squads: 3,
  ranks: 3 as const,
} satisfies Plan['settings'];

const roster = Array.from({ length: 18 }, (_, i) => ({
  id: `cadet-${i}`,
  height: 1.78 - (i % 6) * 0.01,
}));

let n = 0;
const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: `${type}-${n++}`,
  type,
  params,
});

function timelineOf(types: string[]) {
  const plan: Plan = {
    version: 1,
    name: 'dress turns',
    settings,
    roster,
    programme: types.map((type) => move(type)),
  };
  return buildTimeline(plan);
}

function dressOf(timeline: ReturnType<typeof buildTimeline>) {
  const dress = timeline.segments.find((s) => s.type === 'rightDress');
  if (!dress) throw new Error('no right dress');
  return dress;
}

/** The greatest distance any soldier is carried during the dress action. */
function dressMove(timeline: ReturnType<typeof buildTimeline>) {
  const dress = dressOf(timeline);
  const before = sampleTimeline(timeline, dress.start + 1e-5);
  const after = sampleTimeline(timeline, dress.actionEnd - 1e-5);
  let moved = 0;
  for (const s of before.soldiers) {
    const e = after.soldiers.find((x) => x.soldier.id === s.soldier.id)!;
    moved = Math.max(moved, Math.hypot(e.x - s.x, e.z - s.z));
  }
  return { dress, before, after, moved };
}

describe('right dress after a turn', () => {
  it('dresses on the current front-right person after an about turn', () => {
    const timeline = timelineOf(['fallIn', 'attention', 'aboutTurn', 'rightDress']);
    const { dress, moved } = dressMove(timeline);
    const marker = timeline.soldiers.find((s) => s.role === 'marker')!;

    // The about turn leaves the marker on the left. The old rear-left person
    // is now the right-hand person of the front rank and must stand fast.
    const ranks = timeline.soldiers.filter((s) => s.rank < 90);
    const local = (id: string) => dress.fromLocal[id]!;
    const frontZ = Math.max(...ranks.map((s) => local(s.id).lz));
    const front = ranks.filter((s) => local(s.id).lz >= frontZ - 0.3);
    const right = front.reduce((best, s) => (local(s.id).lx > local(best.id).lx ? s : best));

    expect(right.id).not.toBe(marker.id);
    expect(dress.steps?.[right.id]).toBeUndefined();
    expect(dress.toLocal[right.id].lx).toBeCloseTo(local(right.id).lx, 9);
    expect(dress.toLocal[right.id].lz).toBeCloseTo(local(right.id).lz, 9);

    // The old marker is no longer the directing flank, so he dresses with the
    // rest of the squad instead of sliding 2.16 m across the square.
    expect(dress.steps?.[marker.id]).toBeDefined();
    expect(moved).toBeLessThan(0.35);

    // The arm follows the current front rank, not the rank held at fall-in.
    // The right-hand person stands fast; the rest of that rank raise an arm.
    expect([...(dress.dressArm ?? [])].sort()).toEqual(
      front
        .filter((s) => s.id !== right.id)
        .map((s) => s.id)
        .sort(),
    );
    expect(dress.dressArm).not.toContain(marker.id);
    for (const s of timeline.soldiers.filter((x) => x.rank === 0)) {
      expect(dress.dressArm, s.id).not.toContain(s.id);
    }
    const mid = sampleTimeline(timeline, dress.start + (dress.actionEnd - dress.start) * 0.6);
    for (const s of mid.soldiers) {
      expect(s.dressArm, s.soldier.id).toBe(
        Boolean(dress.dressArm?.includes(s.soldier.id)),
      );
    }
  });

  it('carries the current front rank into the EYES FRONT arm cut', () => {
    const timeline = timelineOf([
      'fallIn',
      'attention',
      'aboutTurn',
      'rightDress',
      'eyesFront',
    ]);
    const dress = timeline.segments.find((s) => s.type === 'rightDress')!;
    const eyes = timeline.segments.find((s) => s.type === 'eyesFront')!;
    expect(eyes.dressArm).toEqual(dress.dressArm);

    const mid = sampleTimeline(timeline, eyes.start + (eyes.actionEnd - eyes.start) * 0.3);
    for (const s of mid.soldiers) {
      expect(s.dressArm, s.soldier.id).toBe(
        Boolean(eyes.dressArm?.includes(s.soldier.id)),
      );
    }
  });

  it('does not walk the squad back after a run of in-place turns', () => {
    const timeline = timelineOf([
      'fallIn',
      'attention',
      'rightTurn',
      'leftTurn',
      'aboutTurn',
      'rightIncline',
      'leftIncline',
      'rightDress',
    ]);
    const { moved, dress } = dressMove(timeline);
    expect(moved).toBeLessThan(0.4);

    const commander = dress.fromLocal.commander;
    expect(dress.toLocal.commander.lx).toBeCloseTo(commander.lx, 9);
    expect(dress.toLocal.commander.lz).toBeCloseTo(commander.lz, 9);
  });

  it('keeps the right-hand person standing fast after a right turn', () => {
    const timeline = timelineOf(['fallIn', 'attention', 'rightTurn', 'rightDress']);
    const { moved, dress } = dressMove(timeline);
    expect(moved).toBeLessThan(0.4);

    const ranks = timeline.soldiers.filter((s) => s.rank < 90);
    const local = (id: string) => dress.fromLocal[id]!;
    const frontZ = Math.max(...ranks.map((s) => local(s.id).lz));
    const front = ranks.filter((s) => local(s.id).lz >= frontZ - 0.3);
    const right = front.reduce((best, s) => (local(s.id).lx > local(best.id).lx ? s : best));
    expect(dress.steps?.[right.id]).toBeUndefined();
  });

  it('still closes up a fall-in dressing error when no turn has happened', () => {
    const timeline = timelineOf(['fallIn', 'attention', 'rightDress']);
    const { moved, dress } = dressMove(timeline);
    const marker = timeline.soldiers.find((s) => s.role === 'marker')!;

    expect(moved).toBeGreaterThan(0.01);
    expect(moved).toBeLessThan(0.3);
    expect(dress.steps?.[marker.id]).toBeUndefined();

    const dressed = timeline.soldiers.filter((s) => s.role === 'cadet' || s.role === 'marker');
    for (const s of dressed) {
      expect(dress.toLocal[s.id], s.name).toBeDefined();
    }

    // A fresh dress still raises the arm on the fall-in front rank: the
    // marker stands fast, the other front-rank cadets raise.
    const frontRank = timeline.soldiers.filter((s) => s.rank === 0);
    expect(dress.dressArm).toHaveLength(frontRank.length - 1);
    for (const s of frontRank) {
      if (s.role === 'marker') expect(dress.dressArm).not.toContain(s.id);
      else expect(dress.dressArm).toContain(s.id);
    }
  });
});
