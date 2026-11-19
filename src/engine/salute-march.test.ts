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
    name: 'salute on the march',
    settings: { ...settings, ...over },
    roster,
    programme,
  };
  return buildTimeline(plan);
}

const timeline = timelineOf([
  move('attention'),
  move('quickMarch', { paces: 4 }),
  move('saluteOnMarch'),
  move('eyesFrontMarch'),
  move('quickMarch', { paces: 4 }),
]);
const salute = timeline.segments[2];
const at = (t: number) => sampleTimeline(timeline, salute.start + t);

describe('salute on the march', () => {
  it('is eight paced counts that cover eight paces of ground', () => {
    expect(salute.type).toBe('saluteOnMarch');
    expect(salute.actionEnd - salute.start).toBeCloseTo(8 * BEAT, 6);
    // It is a march, not a pause: the squad must pass the officer.
    expect(salute.mode).toBe('linear');
    expect(salute.steps).toBeDefined();
    // The command is given as the left foot is forward and on the ground, so
    // the march handing over to it finishes on the left foot.
    const id = timeline.soldiers[0].id;
    const before = sampleStepPlan(timeline.segments[1].steps![id], 1);
    expect(before.left.z, 'left foot forward at the command').toBeGreaterThan(
      before.right.z + 0.2,
    );
    expect(
      Math.hypot(salute.toFrame.x - salute.fromFrame.x, salute.toFrame.z - salute.fromFrame.z),
    ).toBeCloseTo(6, 6);
    // The arm is down and the next march swings it: no held salute leaks out.
    expect(salute.toSnapshot.posture).toBe('attention');
    // The salute completes itself: the head is back to the front, so no EYES
    // FRONT (which this command never orders) is needed to finish it.
    expect(salute.toSnapshot.eyes).toBe('front');
  });

  it('raises the arm on UP, holds five footfalls, cuts on DOWN and swings on SWING', () => {
    // Footfalls sit half a beat inside the ends: CHECK at 0.25 s, SWING at 3.75 s.
    expect(at(0.25).saluteArm, 'CHECK, right foot').toBe(0);
    expect(at(0.75).saluteArm, 'UP, left foot').toBe(1);
    for (const t of [1.25, 1.75, 2.25, 2.75]) {
      expect(at(t).saluteArm, `held at ${t} s`).toBe(1);
    }
    expect(at(3.25).saluteArm, 'DOWN, right foot').toBe(0);
    expect(at(3.75).saluteArm, 'SWING, left foot').toBe(0);
    expect(at(4).saluteArm).toBe(0);
  });

  it('turns the head on UP and cuts it back to the front on SWING', () => {
    expect(at(0.25).eyesAmount).toBe(0);
    expect(at(0.5).eyesAmount).toBe(0);
    expect(at(0.75).eyesAmount).toBe(1);
    expect(at(2).eyesAmount).toBe(1);
    expect(at(3.25).eyesAmount, 'DOWN, right foot').toBe(1);
    expect(at(3.75).eyesAmount, 'SWING, left foot').toBe(0);
    expect(at(4).eyesAmount).toBe(0);
  });

  it('leaves EYES FRONT to turn the head back while the arms swing', () => {
    const front = timeline.segments[3];
    expect(front.fromSnapshot.posture).toBe('attention');
    expect(front.fromSnapshot.eyes).toBe('front');
    expect(front.toSnapshot.eyes).toBe('front');
    const march = timeline.segments[4];
    expect(march.fromSnapshot.posture).toBe('attention');
    expect(sampleTimeline(timeline, march.start + 0.1).saluteArm).toBeUndefined();
  });
});

describe("the commander's salute on an eyes right", () => {
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
  const right = cmd.segments[2];
  const middle = cmd.segments[3];
  const front = cmd.segments[4];

  it('rises through the eyes right and is cut by the end of eyes front', () => {
    expect(sampleTimeline(cmd, right.start + 1e-6).commanderSalute).toBeCloseTo(0, 6);
    expect(sampleTimeline(cmd, right.actionEnd).commanderSalute).toBe(1);
    // Held through the march in between, then cut on EYES FRONT.
    expect(sampleTimeline(cmd, middle.start + 1e-6).commanderSalute).toBe(1);
    expect(sampleTimeline(cmd, middle.actionEnd).commanderSalute).toBe(1);
    expect(sampleTimeline(cmd, front.start + 1e-6).commanderSalute).toBeCloseTo(1, 6);
    expect(sampleTimeline(cmd, front.actionEnd).commanderSalute).toBe(0);
    // The ranks swing through an eyes right; only the commander salutes.
    expect(sampleTimeline(cmd, right.start + 1e-6).saluteArm).toBeUndefined();
    expect(sampleTimeline(cmd, front.actionEnd).saluteArm).toBeUndefined();
  });
});
