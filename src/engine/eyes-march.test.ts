import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS } from './constants';
import { buildTimeline, sampleTimeline } from './simulate';
import { sampleStepPlan } from './steps';
import type { Plan } from './types';

const settings: Plan['settings'] = {
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
};

const roster = Array.from({ length: 6 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));
const move = (type: string, params: Record<string, number | string> = {}) => ({ id: type, type, params });

function timelineOf(programme: Plan['programme'], over: Partial<Plan['settings']> = {}) {
  const plan: Plan = {
    version: 1,
    name: 'eyes on the march',
    settings: { ...settings, ...over },
    roster,
    programme,
  };
  return buildTimeline(plan);
}

const timeline = timelineOf([
  move('attention'),
  move('quickMarch', { paces: 4 }),
  move('eyesRight'),
  move('quickMarch', { paces: 2 }),
  move('eyesFrontMarch'),
  move('quickMarch', { paces: 2 }),
]);
const right = timeline.segments[2];
const middle = timeline.segments[3];
const front = timeline.segments[4];
const id = timeline.soldiers[1].id;
const at = (t: number) => sampleTimeline(timeline, right.start + t);
const frontAt = (t: number) => sampleTimeline(timeline, front.start + t);

describe('eyes right on the march', () => {
  it('marches the two paces instead of freezing the squad', () => {
    expect(right.type).toBe('eyesRight');
    expect(right.mode).toBe('linear');
    expect(right.actionEnd - right.start).toBeCloseTo(2 * BEAT, 6);
    expect(right.steps).toBeDefined();
    // Two 75 cm paces, not a pause on the spot.
    expect(
      Math.hypot(right.toFrame.x - right.fromFrame.x, right.toFrame.z - right.fromFrame.z),
    ).toBeCloseTo(1.5, 6);
    // The command is given on the left foot: the march handing over finishes
    // with the left forward, so the first pace of the eyes right is the right's.
    const before = sampleStepPlan(timeline.segments[1].steps![id], 1);
    expect(before.left.z, 'left foot forward at the command').toBeGreaterThan(
      before.right.z + 0.2,
    );
    // The second pace lands the left foot again, as the manual counts it.
    const after = sampleStepPlan(right.steps![id], 1);
    expect(after.left.z, 'left foot lands at the end').toBeGreaterThan(after.right.z + 0.2);
    // The squad carries straight on into the next march.
    expect(middle.fromFrame.z).toBeCloseTo(right.toFrame.z, 9);
    expect(middle.fromSnapshot.eyes).toBe('right');
  });

  it('turns the head as the left foot lands, not at the start or at 45 per cent', () => {
    expect(at(1e-6).eyesAmount).toBe(0);
    expect(at(0.4).eyesAmount).toBe(0);
    expect(at(0.5).eyesAmount).toBe(0);
    expect(at(0.75).eyesAmount).toBeCloseTo(0.5, 6);
    expect(at(1).eyesAmount).toBeCloseTo(1, 6);
    expect(right.toSnapshot.eyes).toBe('right');
    expect(right.toSnapshot.posture).toBe('attention');
    // The head stays right through the march that follows, with no extra
    // movement and no snap back at the seam.
    expect(sampleTimeline(timeline, middle.start + 0.3).eyesAmount).toBeUndefined();
  });
});

describe('eyes front on the march', () => {
  it('cuts the head back to the front as the left foot lands', () => {
    expect(front.type).toBe('eyesFrontMarch');
    expect(front.mode).toBe('linear');
    expect(front.fromSnapshot.eyes).toBe('right');
    expect(front.toSnapshot.eyes).toBe('front');
    expect(front.actionEnd - front.start).toBeCloseTo(2 * BEAT, 6);
    expect(front.toFrame.z - front.fromFrame.z).toBeCloseTo(1.5, 6);
    expect(frontAt(0.25).eyesAmount).toBeCloseTo(1, 6);
    expect(frontAt(0.75).eyesAmount).toBeCloseTo(0.5, 6);
    expect(frontAt(1).eyesAmount).toBeCloseTo(0, 6);
    // The ranks keep swinging their arms through both movements.
    expect(frontAt(0.5).saluteArm).toBeUndefined();
    expect(at(0.5).saluteArm).toBeUndefined();
  });

  it("cuts the commander's salute on the right foot, half a beat before the head", () => {
    const cmd = timelineOf(
      [
        move('attention'),
        move('quickMarch', { paces: 4 }),
        move('eyesRight'),
        move('quickMarch', { paces: 2 }),
        move('eyesFrontMarch'),
      ],
      { commander: true },
    );
    const r = cmd.segments[2];
    const f = cmd.segments[4];
    // EYES RIGHT: the salute rises through the second pace and is up as the
    // squad's head turns on the left footfall.
    expect(sampleTimeline(cmd, r.start + 0.25).commanderSalute).toBe(0);
    expect(sampleTimeline(cmd, r.start + 0.75).commanderSalute).toBeCloseTo(0.5, 6);
    expect(sampleTimeline(cmd, r.actionEnd).commanderSalute).toBeCloseTo(1, 6);
    // EYES FRONT: checked to the side on the right foot (half-way), and held
    // there while the squad cuts its head on the following left foot.
    expect(sampleTimeline(cmd, f.start + 0.25).commanderSalute).toBeCloseTo(0.5, 6);
    expect(sampleTimeline(cmd, f.start + 0.5).commanderSalute).toBe(0);
    expect(sampleTimeline(cmd, f.actionEnd).commanderSalute).toBe(0);
  });
});
