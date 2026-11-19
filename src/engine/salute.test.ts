import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS, STANDARD_PAUSE } from './constants';
import {
  ARM_MAX_REACH,
  BODY,
  HAND_REACH,
  POSTURE_HANDS,
  distance,
  levelElbow,
  normalize,
  saluteArmAt,
  shoulderOf,
  type Vec3,
} from './pose';
import { buildTimeline, sampleTimeline } from './simulate';
import type { Plan } from './types';

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 4,
  squads: 1,
  ranks: 2,
  colours: 0,
  commander: false,
  supernumerary: false,
  armed: false,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 4 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));

function planOf(types: string[]): Plan {
  return {
    version: 1,
    name: 'salute',
    settings,
    roster,
    programme: types.map((type) => ({ id: type, type, params: {} })),
  };
}

describe('salute at the halt', () => {
  it('is two movements: ONE to the brow, the standard pause, TWO cut away', () => {
    const seg = buildTimeline(planOf(['attention', 'salute'])).segments[1];
    expect(seg.type).toBe('salute');
    // One beat up, two beats held, one beat down.
    expect(seg.actionEnd - seg.start).toBeCloseTo(2 * BEAT + STANDARD_PAUSE, 6);
    // The salute is complete in itself; the squad is at attention afterwards.
    expect(seg.toSnapshot.posture).toBe('attention');

    expect(saluteArmAt(0)).toBe(0);
    expect(saluteArmAt(0.125)).toBeGreaterThan(0);
    expect(saluteArmAt(0.125)).toBeLessThan(1);
    expect(saluteArmAt(0.25)).toBe(1);
    expect(saluteArmAt(0.75)).toBe(1);
    expect(saluteArmAt(0.875)).toBeLessThan(1);
    expect(saluteArmAt(1)).toBe(0);

    const timeline = buildTimeline(planOf(['attention', 'salute', 'standAtEase']));
    const [, up, ease] = timeline.segments;
    expect(sampleTimeline(timeline, up.start + BEAT).saluteArm).toBe(1);
    expect(sampleTimeline(timeline, up.actionEnd).saluteArm).toBe(0);
    // STAND AT EASE is given from attention, not from a held salute.
    expect(ease.fromSnapshot.posture).toBe('attention');
  });

  it('solves the salute with a level upper arm and the straight hand at the headdress', () => {
    const shoulder = shoulderOf(-1);
    const wrist = POSTURE_HANDS.salute.right;
    expect(distance(wrist, shoulder)).toBeLessThan(ARM_MAX_REACH);

    const elbow = levelElbow(shoulder, wrist);
    expect(elbow).not.toBeNull();
    // The upper arm is parallel to the ground and the elbow is in line with
    // the shoulder: the joint shares the shoulder's height.
    expect(elbow![1]).toBeCloseTo(shoulder[1], 6);
    expect(distance(elbow!, shoulder)).toBeCloseTo(BODY.humerus, 6);
    expect(distance(elbow!, wrist)).toBeCloseTo(BODY.forearm, 6);

    // Hand, wrist and forearm in a straight line take the second fingertip to
    // the headdress side of the eyebrow. The live-rig test pins the contact
    // with the shoulder girdle's lift included.
    const dir = normalize([
      wrist[0] - elbow![0],
      wrist[1] - elbow![1],
      wrist[2] - elbow![2],
    ]);
    const tip: Vec3 = [
      wrist[0] + dir[0] * HAND_REACH,
      wrist[1] + dir[1] * HAND_REACH,
      wrist[2] + dir[2] * HAND_REACH,
    ];
    expect(tip[1]).toBeGreaterThan(0.55);
    expect(tip[1]).toBeLessThan(0.61);
    expect(Math.abs(tip[0])).toBeLessThan(0.13);
    expect(tip[2]).toBeGreaterThan(0.03);
  });
});
