import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS, STANDARD_PAUSE } from './constants';
import {
  POSTURE_HANDS,
  RIFLE,
  RIFLE_CARRIAGE,
  carriageDir,
  carriagePoint,
  type Carriage,
  type Vec3,
} from './pose';
import { riflePlanFor, sampleRifle } from './rifle';
import { buildTimeline, sampleTimeline } from './simulate';
import { PRESENT_RIGHT, sampleStepPlan } from './steps';
import type { Plan } from './types';

const close = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const settings = {
  ...DEFAULT_SETTINGS,
  strength: 6,
  squads: 1,
  ranks: 2,
  colours: 0,
  commander: false,
  supernumerary: false,
  armed: true,
  uniform: 'army',
  headingDeg: 0,
} satisfies Plan['settings'];

const roster = Array.from({ length: 6 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));
const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: type,
  type,
  params,
});

function timelineOf(programme: Plan['programme']) {
  const plan: Plan = { version: 1, name: 'rifle test', settings, roster, programme };
  return buildTimeline(plan);
}

function at(plan: ReturnType<typeof riflePlanFor>, elapsed: number) {
  if (!plan) throw new Error('no rifle plan');
  return sampleRifle(plan, elapsed, 'attention');
}

describe('rifle carriage counts', () => {
  it('schedules the manual counts with the standard pause between them', () => {
    const plan = riflePlanFor('slopeArms', 'order')!;
    expect(plan.counts).toBe(3);
    expect(plan.steps.map((s) => [s.count, s.start, s.end])).toEqual([
      [1, 0, BEAT],
      [2, BEAT + STANDARD_PAUSE, 2 * BEAT + STANDARD_PAUSE],
      [3, 2 * BEAT + 2 * STANDARD_PAUSE, 3 * BEAT + 2 * STANDARD_PAUSE],
    ]);
    expect(plan.duration).toBeCloseTo(3 * BEAT + 2 * STANDARD_PAUSE, 6);
  });

  it('slope arms: catches on ONE, shoulders on TWO, cuts the right arm on THREE', () => {
    const plan = riflePlanFor('slopeArms', 'order')!;
    const one = at(plan, plan.steps[0].end);
    const two = at(plan, plan.steps[1].end);
    const three = at(plan, plan.steps[2].end);

    // ONE: left hand on the forestock, right hand at the small of the butt.
    expect(one.gripL).toBe(1);
    expect(one.gripR).toBe(1);
    expect(close(one.handL, carriagePoint(one.carriage, RIFLE.grip.balance))).toBeLessThan(1e-9);
    expect(close(one.handR, carriagePoint(one.carriage, RIFLE.grip.small))).toBeLessThan(1e-9);
    expect(one.handL[1]).toBeGreaterThan(one.handR[1]);

    // TWO: left hand around the butt plate, right at the small, rifle on the
    // left shoulder.
    expect(two.gripL).toBe(1);
    expect(two.gripR).toBe(1);
    expect(close(two.handL, carriagePoint(two.carriage, 0.02))).toBeLessThan(1e-9);
    expect(close(two.handR, carriagePoint(two.carriage, RIFLE.grip.small))).toBeLessThan(1e-9);
    expect(two.carriage.butt[0]).toBeGreaterThan(0.1);
    expect(two.carriage.dir[1]).toBeGreaterThan(0.8);

    // THREE: the left hand holds the butt; the right arm is at the side.
    expect(three.gripL).toBe(1);
    expect(three.gripR).toBe(0);
    expect(close(three.handL, carriagePoint(three.carriage, 0.02))).toBeLessThan(1e-9);
    expect(three.handR).toEqual(POSTURE_HANDS.attention.right);
  });

  it('order arms: left side on ONE, down to the right on TWO, left hand cut on THREE', () => {
    const plan = riflePlanFor('orderArms', 'slope')!;
    const one = at(plan, plan.steps[0].end);
    const two = at(plan, plan.steps[1].end);
    const three = at(plan, plan.steps[2].end);

    // ONE: rifle vertical on the left side, both hands.
    expect(one.carriage.butt[0]).toBeGreaterThan(0.1);
    expect(one.gripL).toBe(1);
    expect(one.gripR).toBe(1);
    expect(close(one.handL, carriagePoint(one.carriage, 0.02))).toBeLessThan(1e-9);
    expect(close(one.handR, carriagePoint(one.carriage, RIFLE.grip.balance))).toBeLessThan(1e-9);

    // TWO: order position at the right side, left hand at the muzzle.
    expect(two.carriage.butt[0]).toBeCloseTo(RIFLE_CARRIAGE.order.butt[0], 6);
    expect(two.carriage.butt[1]).toBeCloseTo(RIFLE_CARRIAGE.order.butt[1], 6);
    expect(two.gripL).toBe(1);
    expect(two.gripR).toBe(1);
    expect(close(two.handL, carriagePoint(two.carriage, RIFLE.grip.muzzle))).toBeLessThan(1e-9);
    expect(close(two.handR, carriagePoint(two.carriage, 0.9))).toBeLessThan(1e-9);

    // THREE: right hand at the order grip, left hand back at the side.
    expect(three.gripL).toBe(0);
    expect(three.gripR).toBe(1);
    expect(close(three.handR, carriagePoint(three.carriage, RIFLE.grip.order))).toBeLessThan(1e-9);
    expect(three.handL).toEqual(POSTURE_HANDS.attention.left);
  });

  it('present arms: re-grips on ONE, raises on TWO, presents and places the right foot on THREE', () => {
    const plan = riflePlanFor('presentArms', 'slope')!;
    const one = at(plan, plan.steps[0].end);
    const two = at(plan, plan.steps[1].end);
    const three = at(plan, plan.steps[2].end);

    // ONE: still on the shoulder, right hand back at the small.
    expect(one.gripL).toBe(1);
    expect(one.gripR).toBe(1);
    expect(close(one.handR, carriagePoint(one.carriage, RIFLE.grip.small))).toBeLessThan(1e-9);

    // TWO: perpendicular in front of the centre, left hand at the balance.
    expect(two.carriage.dir[1]).toBeGreaterThan(0.99);
    expect(Math.abs(two.carriage.butt[0])).toBeLessThan(0.06);
    expect(two.gripL).toBe(1);
    expect(close(two.handL, carriagePoint(two.carriage, RIFLE.grip.balance))).toBeLessThan(1e-9);

    // THREE: the present position.
    expect(three.carriage.butt).toEqual(RIFLE_CARRIAGE.present.butt);
    expect(three.gripL).toBe(1);
    expect(three.gripR).toBe(1);
  });

  it('slope from present: shoulders on ONE, closes the right foot and cuts the arm on TWO', () => {
    const plan = riflePlanFor('slopeFromPresent', 'present')!;
    const one = at(plan, plan.steps[0].end);
    const two = at(plan, plan.steps[1].end);
    expect(one.gripL).toBe(1);
    expect(one.gripR).toBe(1);
    expect(one.carriage.butt[0]).toBeGreaterThan(0.1);
    expect(two.gripL).toBe(1);
    expect(two.gripR).toBe(0);
    expect(two.carriage.butt[0]).toBeGreaterThan(0.1);
  });

  it('keeps every gripping hand on the rifle during the motion, not on a chord', () => {
    for (const [type, from] of [
      ['slopeArms', 'order'],
      ['orderArms', 'slope'],
      ['presentArms', 'slope'],
      ['slopeFromPresent', 'present'],
    ] as const) {
      const plan = riflePlanFor(type, from)!;
      for (const step of plan.steps) {
        for (let i = 0; i <= 8; i += 1) {
          const elapsed = step.start + ((step.end - step.start) * i) / 8;
          const sample = at(plan, elapsed);
          const offAxis = (hand: Vec3) => {
            const dir = carriageDir(sample.carriage);
            const v: Vec3 = [
              hand[0] - sample.carriage.butt[0],
              hand[1] - sample.carriage.butt[1],
              hand[2] - sample.carriage.butt[2],
            ];
            const along = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
            const perp = Math.hypot(
              v[0] - dir[0] * along,
              v[1] - dir[1] * along,
              v[2] - dir[2] * along,
            );
            return { perp, along };
          };
          if (sample.gripL > 0.999) {
            const { perp, along } = offAxis(sample.handL);
            expect(perp, `${type} left axis ${elapsed}`).toBeLessThan(1e-6);
            expect(along).toBeGreaterThan(0);
            expect(along).toBeLessThan(RIFLE.length);
          }
          if (sample.gripR > 0.999) {
            const { perp, along } = offAxis(sample.handR);
            expect(perp, `${type} right axis ${elapsed}`).toBeLessThan(1e-6);
            expect(along).toBeGreaterThan(0);
            expect(along).toBeLessThan(RIFLE.length);
          }
        }
      }
    }
  });
});

describe('rifle footwork and timeline', () => {
  it('attaches the three-count plan and its duration to the segment', () => {
    const timeline = timelineOf([move('attention'), move('slopeArms'), move('orderArms')]);
    const slope = timeline.segments.find((s) => s.type === 'slopeArms')!;
    expect(slope.rifle).toBeDefined();
    expect(slope.actionEnd - slope.start).toBeCloseTo(3.5, 6);
    expect(slope.end - slope.actionEnd).toBeCloseTo(STANDARD_PAUSE, 6);
    const one = sampleTimeline(timeline, slope.start + 0.5);
    expect(one.rifle?.gripL).toBe(1);
    expect(one.rifle?.gripR).toBe(1);
  });

  it('places the right foot 15 cm behind on the present, and closes it on the slope', () => {
    const timeline = timelineOf([
      move('attention'),
      move('slopeArms'),
      move('presentArms'),
      move('slopeFromPresent'),
      move('quickMarch', { paces: 2 }),
    ]);
    const present = timeline.segments.find((s) => s.type === 'presentArms')!;
    const slope = timeline.segments.find((s) => s.type === 'slopeFromPresent')!;
    expect(present.toSnapshot.stance).toBe('present');
    expect(slope.fromSnapshot.stance).toBe('present');
    expect(slope.toSnapshot.stance).toBe('attention');
    const id = timeline.soldiers[0].id;
    const presentPlan = present.steps![id];
    const slopePlan = slope.steps![id];
    expect(presentPlan).toBeDefined();
    expect(slopePlan).toBeDefined();

    const start = sampleStepPlan(presentPlan, 0);
    const done = sampleStepPlan(presentPlan, 1);
    expect(start.right.z).toBeCloseTo(0, 6);
    expect(done.right.z).toBeCloseTo(PRESENT_RIGHT.z, 6);
    expect(done.right.x).toBeCloseTo(PRESENT_RIGHT.x, 6);
    expect(done.right.yaw).toBeCloseTo(PRESENT_RIGHT.yaw, 6);
    expect(done.left.planted).toBe(true);

    // The two movements share the exact same planted right foot at the seam.
    const nextStart = sampleStepPlan(slopePlan, 0);
    expect(nextStart.right.z).toBeCloseTo(done.right.z, 6);
    expect(nextStart.right.x).toBeCloseTo(done.right.x, 6);
    expect(nextStart.right.yaw).toBeCloseTo(done.right.yaw, 6);
    const closed = sampleStepPlan(slopePlan, 1);
    expect(closed.right.z).toBeCloseTo(0, 6);
    expect(closed.right.x).toBeCloseTo(-0.04, 6);
    expect(closed.right.yaw).toBeCloseTo(-15, 6);
  });

  it('samples the count frames at the manual times through the timeline', () => {
    const timeline = timelineOf([move('attention'), move('slopeArms')]);
    const seg = timeline.segments.find((s) => s.type === 'slopeArms')!;
    const ends = seg.rifle!.steps.map((s) => s.end);
    const samples = ends.map((t) => sampleTimeline(timeline, seg.start + t).rifle!);
    const carriages: Carriage[] = samples.map((s) => s.carriage);
    expect(carriages[0].butt[1]).toBeGreaterThan(-0.3);
    expect(carriages[1].butt[0]).toBeGreaterThan(0.1);
    expect(samples[0].gripR).toBe(1);
    expect(samples[1].gripR).toBe(1);
    expect(samples[2].gripR).toBe(0);
  });
});
