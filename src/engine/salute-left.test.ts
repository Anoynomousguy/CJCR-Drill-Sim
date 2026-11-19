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
    name: 'salute on the march to the left',
    settings: { ...settings, ...over },
    roster,
    programme,
  };
  return buildTimeline(plan);
}

const timeline = timelineOf([
  move('attention'),
  move('quickMarch', { paces: 4 }),
  move('saluteOnMarchLeft'),
  move('quickMarch', { paces: 4 }),
]);
const salute = timeline.segments[2];
const at = (t: number) => sampleTimeline(timeline, salute.start + t);
const id = timeline.soldiers[0].id;

describe('salute on the march, to the left', () => {
  it('is the manual\u2019s eight paced counts and six metres of ground', () => {
    expect(salute.type).toBe('saluteOnMarchLeft');
    expect(salute.actionEnd - salute.start).toBeCloseTo(8 * BEAT, 6);
    expect(salute.mode).toBe('linear');
    expect(salute.steps).toBeDefined();
    expect(
      Math.hypot(salute.toFrame.x - salute.fromFrame.x, salute.toFrame.z - salute.fromFrame.z),
    ).toBeCloseTo(6, 6);
    // Given on the left foot: the march handing over finishes on the left.
    const before = sampleStepPlan(timeline.segments[1].steps![id], 1);
    expect(before.left.z, 'left foot forward at the command').toBeGreaterThan(
      before.right.z + 0.2,
    );
    // The head finishes front and the arm is down for the next march.
    expect(salute.toSnapshot.posture).toBe('attention');
    expect(salute.toSnapshot.eyes).toBe('front');
  });

  it('raises the arm on UP through FIVE and cuts it on DOWN, like the right', () => {
    expect(at(0.5).saluteArm, 'CHECK, right foot').toBe(0);
    expect(at(1.0).saluteArm, 'UP, left foot').toBe(1);
    for (const t of [1.5, 2.0, 2.5, 3.0]) {
      expect(at(t).saluteArm, `held at ${t} s`).toBe(1);
    }
    expect(at(3.5).saluteArm, 'DOWN, right foot').toBe(0);
    expect(at(3.999).saluteArm, 'SWING, left foot').toBe(0);
  });

  it('turns the head left while the arm is up and back to the front on SWING', () => {
    expect(at(0.99).eyesAmount).toBe(0);
    expect(at(1.0).eyesAmount).toBe(1);
    expect(at(2).eyesAmount).toBe(1);
    expect(at(3.999).eyesAmount).toBeCloseTo(0, 4);
    // Left, not right: the only difference from the salute to the right.
    expect(at(1.0).eyesDir).toBe('left');
    expect(at(2).eyesDir).toBe('left');
    // The ranks keep marching through it.
    expect(at(2).saluteArm).toBe(1);
    expect(
      Math.hypot(salute.toFrame.x - salute.fromFrame.x, salute.toFrame.z - salute.fromFrame.z),
    ).toBeCloseTo(6, 6);
  });
});
