import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS, PACE, PACE_HALF } from './constants';
import { LEG, REACH, solveKnee } from './gait';
import { buildTimeline, sampleTimeline } from './simulate';
import { sampleStepPlan } from './steps';
import type { Plan } from './types';

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 12,
  squads: 4,
  ranks: 3,
  armed: true,
  colours: 0,
  commander: true,
  headingDeg: 0,
};

const roster = Array.from({ length: 12 }, (_, i) => ({
  id: `cadet-${i}`,
  height: 1.78 - (i % 5) * 0.015,
}));

let n = 0;
const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: `${type}-${n++}`,
  type,
  params,
});

// Six paces, a change step, four paces and a halt. The march before the
// change step must hand over on the right foot, and the one after it must
// plant its first boot a full beat after the change step's last landing.
const plan: Plan = {
  version: 1,
  name: 'change step',
  settings,
  roster,
  programme: [
    move('attention'),
    move('rightDress'),
    move('eyesFront'),
    move('slopeArms'),
    move('quickMarch', { paces: 6 }),
    move('changeStep'),
    move('quickMarch', { paces: 4 }),
    move('halt'),
  ],
};

const timeline = buildTimeline(plan);
const changeIndex = timeline.segments.findIndex((s) => s.type === 'changeStep');
const change = timeline.segments[changeIndex];
const before = timeline.segments[changeIndex - 1];
const after = timeline.segments[changeIndex + 1];
const id = timeline.soldiers[0].id;

type Timeline = ReturnType<typeof buildTimeline>;
type Segment = Timeline['segments'][number];

const worldFoot = (
  soldier: { x: number; z: number; heading: number },
  foot: { x: number; z: number },
) => {
  const cos = Math.cos(soldier.heading);
  const sin = Math.sin(soldier.heading);
  return { x: soldier.x + foot.x * cos + foot.z * sin, z: soldier.z - foot.x * sin + foot.z * cos };
};

/** Every boot landing in a segment, from the step plan sampled on the timeline. */
function plantTimes(tl: Timeline, seg: Segment, soldierId: string) {
  const out: { t: number; side: 'left' | 'right'; x: number; z: number }[] = [];
  const was = { left: false, right: false };
  const span = seg.actionEnd - seg.start;
  for (let i = 0; i <= 1000; i += 1) {
    const raw = i / 1000;
    const t = seg.start + raw * span;
    const sample = sampleTimeline(tl, t);
    const stepPlan = sample.steps?.[soldierId];
    if (!stepPlan) continue;
    const step = sampleStepPlan(stepPlan, raw);
    const soldier = sample.soldiers.find((s) => s.soldier.id === soldierId);
    if (!soldier) continue;
    for (const side of ['left', 'right'] as const) {
      const planted = step[side].planted;
      if (planted && !was[side] && raw > 0.02) {
        out.push({ t, side, ...worldFoot(soldier, step[side]) });
      }
      was[side] = planted;
    }
  }
  return out;
}

// The change step runs on a fixed heading, so ground gained is just Δz.
const aheadOf = (a: { x: number; z: number }, b: { x: number; z: number }) => a.z - b.z;

describe('change step on the march', () => {
  const stepPlan = change.steps?.[id];

  it('is given on the right foot and takes the manual’s three movements', () => {
    expect(stepPlan, 'change step needs explicit footwork').toBeDefined();
    expect(stepPlan!.kind).toBe('changeStep');
    expect(stepPlan!.movements).toEqual(['half pace', 'close beside left', 'shot forward']);
    expect(stepPlan!.counts).toBe(3);
    // Half a beat of command time, then three boots one beat apart.
    expect(change.actionEnd - change.start).toBeCloseTo(2.5 * BEAT, 6);
  });

  it('plants the left half a pace on, closes the right beside it, then shoots the left', () => {
    const p = stepPlan!;
    const at = (raw: number) => sampleStepPlan(p, raw);
    const start = at(0);
    const rightStart = start.body.z + start.right.z;
    const first = at(0.2);
    const halfZ = first.body.z + first.left.z;
    const second = at(0.6);
    const closeZ = second.body.z + second.right.z;
    const third = at(1);
    const shotZ = third.body.z + third.left.z;

    // The command boot is the one the previous march finished on: at the seam
    // the body has already passed its ankle by the last half beat of that march.
    expect(start.right.z).toBeGreaterThan(start.left.z);
    expect(rightStart).toBeGreaterThan(-0.2);
    expect(rightStart).toBeLessThan(0.2);
    expect(first.left.planted && first.right.planted).toBe(true);
    expect(second.right.planted).toBe(true);
    expect(third.left.planted).toBe(true);

    expect(halfZ - rightStart).toBeCloseTo(PACE_HALF, 2);
    // "Place the right foot smartly beside the left": no ground gained.
    expect(closeZ).toBeCloseTo(halfZ, 3);
    expect(shotZ - closeZ).toBeCloseTo(PACE_HALF, 2);
    // The shot boot lands on the heel, toe up, as the manual orders.
    expect(third.left.pitch).toBeLessThan(-8);
    expect(third.left.contact).toBe('heel');
    // The body finishes just behind the shot boot, having covered most of the
    // two half paces rather than a full three marching paces.
    expect(p.total.z).toBeCloseTo(shotZ - 0.06, 2);
    expect(p.total.z).toBeLessThan(2 * PACE_HALF);
  });

  it('never lets a planted boot slide or the legs over-reach', () => {
    const p = stepPlan!;
    const last: Record<'L' | 'R', { z: number } | null> = { L: null, R: null };
    const was = { L: false, R: false };
    let minHip = Infinity;
    let maxKnee = 0;
    for (let i = 0; i <= 600; i += 1) {
      const s = sampleStepPlan(p, i / 600);
      minHip = Math.min(minHip, s.hipY);
      for (const [foot, side] of [
        [s.left, 'L'] as const,
        [s.right, 'R'] as const,
      ]) {
        // The fixed contact is the ball while the heel rolls up, and the
        // ankle for a flat or heel-strike plant.
        const pitch = (foot.pitch * Math.PI) / 180;
        const yaw = (foot.yaw * Math.PI) / 180;
        const lever =
          foot.contact === 'heel' ? -LEG.heelLever : LEG.mtp * Math.cos(pitch) - LEG.ankle * Math.sin(pitch);
        const world = s.body.z + foot.z + lever * Math.cos(yaw);
        if (foot.planted && was[side] && last[side]) {
          expect(Math.abs(world - last[side]!.z), `${side} slip`).toBeLessThan(0.001);
        }
        last[side] = { z: world };
        was[side] = foot.planted;
        if (!foot.planted) continue;
        const hip: [number, number, number] = [
          side === 'L' ? LEG.hipX : -LEG.hipX,
          s.hipY,
          0,
        ];
        const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
        expect(sol.span, `${side} over-reach`).toBeLessThan(REACH - 0.003);
        maxKnee = Math.max(maxKnee, sol.kneeFlexion);
      }
    }
    // The check step shortens the pace, not the posture: the pelvis stays near
    // standing height and no stance knee folds up into the old squat.
    expect(minHip).toBeGreaterThan(0.86);
    expect(maxKnee).toBeLessThan(45);
  });

  it('keeps the body moving through the check instead of stalling', () => {
    const p = stepPlan!;
    let minSpeed = Infinity;
    const secondsPerRaw = 2.5 * BEAT;
    for (let i = 2; i < 198; i += 1) {
      const raw = i / 200;
      const before = sampleStepPlan(p, raw - 0.002).body.z;
      const after = sampleStepPlan(p, raw + 0.002).body.z;
      minSpeed = Math.min(minSpeed, (after - before) / (0.004 * secondsPerRaw));
    }
    // The boots come together on the middle count, so the squad checks — but
    // at a walking pace, never at a dead stop.
    expect(minSpeed).toBeGreaterThan(0.25);
    expect(p.total.z).toBeGreaterThan(0.6);
  });

  it('lands one boot per beat through both seams and leaves the left forward', () => {
    const landsBefore = plantTimes(timeline, before, id);
    const lands = plantTimes(timeline, change, id);
    const landsAfter = plantTimes(timeline, after, id);

    expect(lands.map((l) => l.side)).toEqual(['left', 'right', 'left']);
    // The command falls on the right footfall: the left lands one beat later.
    expect(lands[0].t - landsBefore[landsBefore.length - 1].t).toBeCloseTo(BEAT, 2);
    for (let i = 1; i < lands.length; i += 1) {
      expect(lands[i].t - lands[i - 1].t, `beat ${i}`).toBeCloseTo(BEAT, 2);
    }
    // The next march takes over one beat after the shot boot lands.
    expect(after.type).toBe('quickMarch');
    expect(after.leadIn).toBe(true);
    expect(landsAfter[0].t - lands[lands.length - 1].t).toBeCloseTo(BEAT, 2);
    expect(landsAfter[0].side).toBe('right');

    // The manual's geometry: half a pace, nothing, half a pace, then a full pace.
    expect(aheadOf(lands[0], landsBefore[landsBefore.length - 1])).toBeCloseTo(PACE_HALF, 2);
    expect(aheadOf(lands[1], lands[0])).toBeCloseTo(0, 2);
    expect(aheadOf(lands[2], lands[1])).toBeCloseTo(PACE_HALF, 2);
    expect(aheadOf(landsAfter[0], lands[2])).toBeCloseTo(PACE, 2);
  });

  it('cuts the arms to the sides on count two and swings again on count three', () => {
    const arms = stepPlan!.armsAt;
    expect(arms).toBeDefined();
    expect(arms!(0.1)).toBe(0);
    expect(arms!(0.4)).toBeGreaterThan(0.9);
    expect(arms!(0.55)).toBeGreaterThan(0.9);
    expect(arms!(0.95)).toBeLessThan(0.1);
  });

  it('runs the programme without a drill warning', () => {
    expect(
      timeline.warnings.filter((w) => w.severity === 'warn' || w.severity === 'error'),
    ).toEqual([]);
  });
});
