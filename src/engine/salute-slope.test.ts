import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS, STANDARD_PAUSE } from './constants';
import {
  ARM_MAX_REACH,
  BODY,
  POSTURE_HANDS,
  RIFLE_CARRIAGE,
  armedSaluteHand,
  carriagePoint,
  distance,
  levelForearmElbow,
  rifleGripElbow,
  shoulderOf,
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
  armed: true,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 4 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));

function planOf(types: string[]): Plan {
  return {
    version: 1,
    name: 'salute at the slope',
    settings,
    roster,
    programme: types.map((type) => ({ id: type, type, params: {} })),
  };
}

const timeline = buildTimeline(planOf(['attention', 'slopeArms', 'saluteAtSlope', 'orderArms']));
const segment = timeline.segments[2];
const target = armedSaluteHand(RIFLE_CARRIAGE.slope);

describe('salute at the slope', () => {
  it('is two numbered movements and leaves the squad at attention with the rifle still at the slope', () => {
    expect(segment.type).toBe('saluteAtSlope');
    // ONE in a beat, the standard pause, TWO in a beat.
    expect(segment.actionEnd - segment.start).toBeCloseTo(2 * BEAT + STANDARD_PAUSE, 6);
    expect(segment.fromSnapshot.weapon).toBe('slope');
    expect(segment.toSnapshot.weapon).toBe('slope');
    // The salute is complete in itself: the next command is given from
    // attention, not from a held salute.
    expect(segment.toSnapshot.posture).toBe('attention');
    expect(timeline.segments[3].fromSnapshot.posture).toBe('attention');
    expect(timeline.segments[3].fromSnapshot.weapon).toBe('slope');
  });

  it('strikes the small of the butt, not the headdress', () => {
    const hold = sampleTimeline(timeline, segment.start + BEAT + 0.5);
    expect(hold.saluteArm).toBe(1);

    // 54-04 para 90: the right arm crosses the body and the hand strikes the
    // small of the butt. The headdress belongs to the salute without arms.
    expect(target[0]).toBeGreaterThan(0.15);
    expect(distance(target, POSTURE_HANDS.salute.right)).toBeGreaterThan(0.3);

    // The left hand keeps the butt plate and the right hand is free, so the
    // rifle never leaves the left shoulder.
    expect(RIFLE_CARRIAGE.slope.hands.right).toBeUndefined();
    const buttPlate = carriagePoint(RIFLE_CARRIAGE.slope, 0.02);
    expect(distance(buttPlate, shoulderOf(1))).toBeLessThan(ARM_MAX_REACH);
  });

  it('levels the left forearm under the butt on the slope', () => {
    const shoulder = shoulderOf(1);
    const wrist = carriagePoint(RIFLE_CARRIAGE.slope, 0.02);
    // A level forearm needs the elbow on the wrist's horizon, so the wrist must
    // hang less than a whole humerus below the shoulder.
    expect(Math.abs(shoulder[1] - wrist[1])).toBeLessThan(BODY.humerus);

    const elbow = rifleGripElbow(shoulder, wrist);
    expect(elbow).not.toBeNull();
    expect(elbow![1]).toBeCloseTo(wrist[1], 9);
    expect(distance(elbow!, shoulder)).toBeCloseTo(BODY.humerus, 9);
    expect(distance(elbow!, wrist)).toBeCloseTo(BODY.forearm, 9);
    // The other intersection is inside the ribcage; this one hangs by the side
    // and the forearm points forward.
    expect(Math.abs(elbow![0])).toBeGreaterThanOrEqual(BODY.shoulderX);
    expect(wrist[2] - elbow![2], 'forearm points forward').toBeGreaterThan(0.2);
  });

  it('levels the right forearm on the small of the butt', () => {
    const shoulder = shoulderOf(-1);
    expect(distance(target, shoulder)).toBeLessThan(ARM_MAX_REACH);
    expect(distance(target, shoulder)).toBeGreaterThan(Math.abs(BODY.humerus - BODY.forearm));

    const elbow = levelForearmElbow(shoulder, target);
    expect(elbow).not.toBeNull();
    // The forearm is parallel to the ground and both bones keep their lengths.
    expect(elbow![1]).toBeCloseTo(target[1], 9);
    expect(distance(elbow!, shoulder)).toBeCloseTo(BODY.humerus, 9);
    expect(distance(elbow!, target)).toBeCloseTo(BODY.forearm, 9);
    // The elbow comes forward of the chest rather than through it.
    expect(elbow![2]).toBeGreaterThan(0.1);
  });

  it('holds through the standard pause and cuts the hand away by the end', () => {
    expect(sampleTimeline(timeline, segment.start + BEAT).saluteArm).toBe(1);
    expect(sampleTimeline(timeline, segment.actionEnd).saluteArm).toBe(0);
  });
});
