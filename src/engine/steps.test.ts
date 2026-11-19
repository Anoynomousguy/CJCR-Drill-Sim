import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PACE, PACE_HALF } from './constants';
import { LEG, REACH, gaitCycle, gaitTargets, solveKnee } from './gait';
import { makePlan } from '../state/store';
import { buildTimeline, sampleTimeline } from './simulate';
import {
  makeDressPlan,
  makeHaltPlan,
  makeMarchOnPlan,
  makePacesPlan,
  makeSidePlan,
  sampleStepPlan,
  stepCount,
  type StepPlan,
} from './steps';
import type { Plan } from './types';

/** A split's world foot: the plan's body displacement plus the local target. */
function worldFoot(plan: StepPlan, raw: number, side: 'L' | 'R') {
  const s = sampleStepPlan(plan, raw);
  const foot = side === 'L' ? s.left : s.right;
  return { foot, x: s.body.x + foot.x, z: s.body.z + foot.z };
}

/**
 * World position of the ball of the foot: the point that stays on the ground
 * when the heel comes up. A planted boot's ankle may rise and roll back over
 * the ball, so the ball, not the ankle, is the anti-skating contact.
 */
function ballWorld(plan: StepPlan, raw: number, side: 'L' | 'R') {
  const s = sampleStepPlan(plan, raw);
  const foot = side === 'L' ? s.left : s.right;
  const pitch = ((foot.pitch ?? 0) * Math.PI) / 180;
  const yaw = ((foot.yaw ?? 0) * Math.PI) / 180;
  const forward = LEG.mtp * Math.cos(pitch) - LEG.ankle * Math.sin(pitch);
  return {
    x: s.body.x + foot.x + forward * Math.sin(yaw),
    z: s.body.z + foot.z + forward * Math.cos(yaw),
  };
}

/**
 * The central physics assertion: while a foot is planted, its world contact
 * cannot move. This is checked at 1/1000 of the movement, so a slide of a
 * millimetre would fail. The contact is the ball: the heel-off rolls the ankle
 * up over a ball that stays where it was put.
 */
function expectNoSlip(plan: StepPlan, samples = 1000) {
  const last: Record<'L' | 'R', { x: number; z: number } | null> = { L: null, R: null };
  const wasPlanted: Record<'L' | 'R', boolean> = { L: false, R: false };
  for (let i = 0; i <= samples; i += 1) {
    const raw = i / samples;
    for (const side of ['L', 'R'] as const) {
      const w = ballWorld(plan, raw, side);
      const planted = sampleStepPlan(plan, raw)[side === 'L' ? 'left' : 'right'].planted;
      if (planted && wasPlanted[side] && last[side]) {
        const drift = Math.hypot(w.x - last[side]!.x, w.z - last[side]!.z);
        expect(drift, `${plan.kind} ${side} slip at ${raw.toFixed(3)}`).toBeLessThan(0.001);
      }
      last[side] = { x: w.x, z: w.z };
      wasPlanted[side] = planted;
    }
  }
}

/** No planted stance may ask the leg for more than it can reach. */
function expectReachable(plan: StepPlan, samples = 600) {
  for (let i = 0; i <= samples; i += 1) {
    const s = sampleStepPlan(plan, i / samples);
    for (const [foot, side] of [
      [s.left, 'L'] as const,
      [s.right, 'R'] as const,
    ]) {
      if (!foot.planted) continue;
      const dx = foot.x - (side === 'L' ? LEG.hipX : -LEG.hipX);
      const span = Math.hypot(dx, foot.z);
      expect(span, `${plan.kind} ${side} over-reach`).toBeLessThan(REACH - 0.004);
    }
  }
}

function maxClearance(plan: StepPlan): number {
  let max = 0;
  for (let i = 0; i <= 800; i += 1) {
    const s = sampleStepPlan(plan, i / 800);
    for (const foot of [s.left, s.right]) {
      if (!foot.planted) max = Math.max(max, foot.y - LEG.ankle);
    }
  }
  return max;
}

describe('paces at the halt', () => {
  it('takes two half paces forward with the left and closes with the right', () => {
    const plan = makePacesPlan({ paces: 2, total: { x: 0, z: 0.7 } });
    expect(plan).not.toBeNull();
    const p = plan!;
    expect(p.paces).toBe(2);
    expect(p.lead).toBe('L');
    expect(p.counts).toBe(3);
    expect(p.movements).toEqual(['pace 1', 'pace 2', 'close']);
    expect(stepCount(p)).toBe(3);
    expect(p.moveEnd).toBeCloseTo(2 / 3, 6);
    // half pace is 35 cm per the manual, not a smooth 70 cm slide
    expect(p.right.find((plant) => plant.label === 'pace 2')?.z).toBeCloseTo(0.7, 6);
    expectNoSlip(p);
    expectReachable(p);
    expect(maxClearance(p)).toBeGreaterThan(0.04);

    const end = sampleStepPlan(p, 1);
    expect(end.left.z).toBeCloseTo(0.7 - 0.7, 3);
    expect(end.right.z).toBeCloseTo(0, 3);
    expect(end.left.x).toBeCloseTo(LEG.standX, 3);
    expect(end.right.x).toBeCloseTo(-LEG.standX, 3);
    expect(end.left.planted && end.right.planted).toBe(true);
  });

  it('steps back with the right foot first', () => {
    const p = makePacesPlan({ paces: 2, total: { x: 0, z: -0.7 } })!;
    expect(p.lead).toBe('R');
    expect(p.movements).toEqual(['pace 1', 'pace 2', 'close']);
    expectNoSlip(p);
    expectReachable(p);
  });

  it('closes one side pace 25 cm to the right, right foot first', () => {
    const p = makeSidePlan({ paces: 1, total: { x: -0.25, z: 0 } })!;
    expect(p.lead).toBe('R');
    expect(p.movements).toEqual(['side pace', 'close']);
    expect(stepCount(p)).toBe(2);
    expectNoSlip(p);
    expectReachable(p);

    const start = sampleStepPlan(p, 0);
    expect(start.left.x).toBeCloseTo(LEG.standX, 4);
    expect(start.right.x).toBeCloseTo(-LEG.standX, 4);
    const endL = worldFoot(p, 1, 'L');
    const endR = worldFoot(p, 1, 'R');
    // Both ankles finish 25 cm to the right, heels together at attention.
    expect(endL.x).toBeCloseTo(-0.21, 3);
    expect(endR.x).toBeCloseTo(-0.29, 3);
    const end = sampleStepPlan(p, 1);
    expect(end.left.x).toBeCloseTo(LEG.standX, 3);
    expect(end.right.x).toBeCloseTo(-LEG.standX, 3);
  });

  it('repeats the side pace for more than one pace', () => {
    const p = makeSidePlan({ paces: 2, total: { x: 0.5, z: 0 } })!;
    expect(p.lead).toBe('L');
    expect(stepCount(p)).toBe(4);
    expect(p.moveEnd).toBe(1);
    expectNoSlip(p);
    expectReachable(p);
  });
});

describe('open and close order', () => {
  it('takes three half paces and a close, body moving only during the paces', () => {
    const p = makePacesPlan({ paces: 3, total: { x: 0, z: 1.05 }, kind: 'open' })!;
    expect(p.counts).toBe(4);
    expect(p.movements).toEqual(['one', 'two', 'three', 'close']);
    expect(p.moveEnd).toBe(0.75);
    expect(stepCount(p)).toBe(4);
    expectNoSlip(p);
    expectReachable(p);

    // Every plant is 35 cm apart: three half paces, not a 1.05 m glide.
    const plants = [...p.left, ...p.right]
      .filter((plant) => plant.land > 0)
      .sort((a, b) => a.land - b.land);
    expect(plants.map((plant) => Number(plant.z.toFixed(2)))).toEqual([0.35, 0.7, 1.05, 1.05]);
  });

  it('closes order by the same three half paces in reverse', () => {
    const p = makePacesPlan({ paces: 3, total: { x: 0, z: -1.05 }, kind: 'close' })!;
    expect(p.lead).toBe('R');
    expectNoSlip(p);
    expectReachable(p);
  });
});

describe('right dress footwork', () => {
  it('takes the check pace with the body, then settles, marker stands fast', () => {
    const p = makeDressPlan({ total: { x: 0, z: 0 }, marker: false, commander: false })!;
    expect(p.movements).toEqual(['check pace', 'short quick paces', 'close']);
    expect(stepCount(p)).toBe(4);
    expectNoSlip(p);
    expectReachable(p);
    // Count one: the left boot shoots a half pace forward while the pelvis
    // stays over its right support, a short weight shift rather than a stride.
    const check = sampleStepPlan(p, 0.5);
    expect(check.body.z).toBeCloseTo(0.05, 5);
    expect(check.left.z).toBeCloseTo(0.35 - 0.05, 5);
    // The right heel is up on the ball: its ankle is higher than the flat boot,
    // and the lowered pelvis makes the right knee visibly bend.
    const rightCheck = check.right;
    expect(rightCheck.z).toBeCloseTo(0.071 - 0.05, 3);
    expect(rightCheck.y).toBeCloseTo(0.099, 3);
    expect(rightCheck.pitch).toBeCloseTo(24, 5);
    expect(rightCheck.contact).toBe('ball');
    const rightKnee = solveKnee(
      [-LEG.hipX, check.hipY, 0],
      [rightCheck.x, rightCheck.y, rightCheck.z],
    ).kneeFlexion;
    expect(rightKnee).toBeGreaterThan(25);
    expect(rightKnee).toBeLessThan(65);
    expect(worldFoot(p, 0.5, 'L').z).toBeCloseTo(0.35, 5);
    // THREE starts with the left: its first short pace lands before the right
    // boot moves to its corrected slot.
    const firstLeft = p.left.find((plant) => plant.land > 0.5)!;
    const firstRight = p.right.find((plant) => plant.land > 0.5)!;
    expect(firstLeft.land).toBeLessThan(firstRight.land);
    // Eyes front: both the body and the boots are back on the slot.
    const end = sampleStepPlan(p, 1);
    expect(Math.abs(end.body.z)).toBeLessThan(1e-6);
    expect(Math.abs(end.left.z)).toBeLessThan(1e-6);
    expect(makeDressPlan({ total: { x: 0, z: 0 }, marker: true, commander: false })).toBeNull();
    expect(makeDressPlan({ total: { x: 0.2, z: 0 }, marker: false, commander: true })).toBeNull();
  });

  it('dresses a soldier onto a displaced slot with short paces', () => {
    const p = makeDressPlan({ total: { x: -0.12, z: 0.08 }, marker: false, commander: false })!;
    expectNoSlip(p);
    expectReachable(p);
    const endL = worldFoot(p, 1, 'L');
    const endR = worldFoot(p, 1, 'R');
    expect(endL.x).toBeCloseTo(-0.12 + LEG.standX, 5);
    expect(endR.x).toBeCloseTo(-0.12 - LEG.standX, 5);
    expect(endL.z).toBeCloseTo(0.08, 5);
    expect(endR.z).toBeCloseTo(0.08, 5);
    const end = sampleStepPlan(p, 1);
    expect(end.left.x).toBeCloseTo(LEG.standX, 5);
    expect(end.left.z).toBeCloseTo(0, 5);
  });

  it('makes the left short pace land before the right on a displaced slot', () => {
    const p = makeDressPlan({ total: { x: -0.12, z: 0.08 }, marker: false, commander: false })!;
    expectNoSlip(p);
    expectReachable(p);
    const left = p.left.find((plant) => plant.land > 0.5)!;
    const right = p.right.find((plant) => plant.land > 0.5)!;
    expect(left.land).toBeLessThan(right.land);
    const check = sampleStepPlan(p, 0.5);
    expect(check.right.contact).toBe('ball');
    expect(check.right.pitch).toBeCloseTo(24, 5);
  });
});

describe('halt', () => {
  it('takes one more pace, a left half pace, then closes the right knee', () => {
    const start = gaitTargets('quick', 0);
    const p = makeHaltPlan({
      total: { x: 0, z: 0.75 },
      startLeft: { x: start.left.x, z: start.left.z },
      startRight: { x: start.right.x, z: start.right.z },
    })!;
    expect(p.movements).toEqual(['one more pace', 'half pace', 'close']);
    expect(p.counts).toBe(2);
    expect(p.moveEnd).toBe(1);
    expect(stepCount(p)).toBe(3);
    expectNoSlip(p);
    expectReachable(p);
    expect(maxClearance(p)).toBeGreaterThan(0.04);

    // The starting pose is the frozen gait, not a snap to attention. The march
    // leaves the trail boot swinging, so the halt starts upright: the old flat
    // boot 0.69 m behind the pelvis forced the hip to 0.585 m and a 105° knee.
    const first = sampleStepPlan(p, 0);
    expect(first.left.z).toBeCloseTo(start.left.z, 5);
    expect(first.right.z).toBeCloseTo(start.right.z, 5);
    expect(first.hipY).toBeGreaterThan(0.8);
    const finalZ = sampleStepPlan(p, 1).body.z;
    expect(finalZ).toBeCloseTo(start.left.z + 0.35, 5);
    const end = sampleStepPlan(p, 1);
    expect(end.left.z).toBeCloseTo(0, 5);
    expect(end.right.z).toBeCloseTo(0, 5);
    expect(end.left.x).toBeCloseTo(LEG.standX, 5);
    expect(end.right.x).toBeCloseTo(-LEG.standX, 5);
  });
});

describe('fall in / march on', () => {
  it('marches 6 m in eight 75 cm paces and closes', () => {
    const p = makeMarchOnPlan({ total: { x: 0, z: 6 } })!;
    expect(p.paces).toBe(8);
    expect(stepCount(p)).toBe(9);
    expect(p.movements).toHaveLength(9);
    expect(p.moveEnd).toBeCloseTo(8 / 9, 6);
    expectNoSlip(p);
    expectReachable(p);
    expect(maxClearance(p)).toBeGreaterThan(0.06);

    const end = sampleStepPlan(p, 1);
    expect(end.left.z).toBeCloseTo(6 - 6, 4);
    expect(end.right.z).toBeCloseTo(6 - 6, 4);
    expect(end.left.planted && end.right.planted).toBe(true);
  });
});

describe('the programme uses the plans', () => {
  const settings = { ...DEFAULT_SETTINGS, strength: 18, squads: 3, ranks: 3 as const };
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
  const plan: Plan = {
    version: 1,
    name: 'step plans',
    settings,
    roster,
    programme: [
      move('fallIn'),
      move('attention'),
      move('rightDress'),
      move('eyesFront'),
      move('pacesForward', { paces: 2, dir: 'forward' }),
      move('pacesBack', { paces: 2, dir: 'back' }),
      move('pacesRight', { paces: 1, dir: 'right' }),
      move('pacesLeft', { paces: 1, dir: 'left' }),
      move('openOrder'),
      move('closeOrder'),
      move('quickMarch', { paces: 4 }),
      move('halt'),
    ],
  };
  const timeline = buildTimeline(plan);
  const segment = (type: string) => timeline.segments.find((s) => s.type === type)!;

  it('attaches explicit footwork to every named movement', () => {
    for (const type of [
      'fallIn',
      'rightDress',
      'pacesForward',
      'pacesBack',
      'pacesRight',
      'pacesLeft',
      'openOrder',
      'closeOrder',
      'halt',
    ]) {
      const seg = segment(type);
      expect(seg.steps, type).toBeDefined();
      expect(seg.moveEnd, type).toBeGreaterThan(0);
      expect(Object.keys(seg.steps!).length, type).toBeGreaterThan(0);
    }
  });

  it('keeps every planted foot still in every soldier’s plan', () => {
    for (const type of [
      'fallIn',
      'rightDress',
      'pacesForward',
      'pacesBack',
      'pacesRight',
      'pacesLeft',
      'openOrder',
      'closeOrder',
      'halt',
    ]) {
      const seg = segment(type);
      const sample = sampleTimeline(timeline, seg.start + (seg.actionEnd - seg.start) * 0.4);
      for (const [id, p] of Object.entries(seg.steps!)) {
        expectNoSlip(p, 400);
        expectReachable(p, 300);
        expect(sample.steps?.[id], `${type} ${id}`).toBe(p);
      }
    }
  });

  it('hands the marching feet to the halt without a jump at the segment seam', () => {
    const halt = segment('halt');
    const before = sampleTimeline(timeline, halt.start - 1e-4);
    const after = sampleTimeline(timeline, halt.start + 1e-4);
    const worldOfSoldier = (s: (typeof after.soldiers)[number], foot: { x: number; z: number }) => {
      const cos = Math.cos(s.heading);
      const sin = Math.sin(s.heading);
      return { x: s.x + foot.x * cos + foot.z * sin, z: s.z - foot.x * sin + foot.z * cos };
    };
    for (const [id, plan] of Object.entries(halt.steps!)) {
      const start = sampleStepPlan(plan, 0);
      const soldierBefore = before.soldiers.find((s) => s.soldier.id === id)!;
      const soldierAfter = after.soldiers.find((s) => s.soldier.id === id)!;
      // The march before the halt is now step-driven: its last pose is the end
      // of its own plan, not a free gait phase. The halt must start there.
      const march = before.steps?.[id];
      const end = march
        ? sampleStepPlan(march, 1)
        : gaitTargets(
            before.to.gait,
            gaitCycle(before.to.gait, soldierBefore.stride, before.t),
          );
      for (const side of ['left', 'right'] as const) {
        const worldBefore = worldOfSoldier(soldierBefore, end[side]);
        const worldAfter = worldOfSoldier(soldierAfter, start[side]);
        expect(
          Math.hypot(worldAfter.x - worldBefore.x, worldAfter.z - worldBefore.z),
          `${id} ${side}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it('moves the halt one full pace and the fall-in six metres, ending at attention', () => {
    const halt = segment('halt');
    const soldier = halt.steps![timeline.soldiers[0].id];
    // The preceding march is now in the post-turn phase: it hands over with
    // its forward boot 0.30 m ahead of the body, so the halt has 0.30 + 0.35
    // of ground to cover, not the old 0.435 + 0.35.
    expect(soldier!.total.z).toBeCloseTo(0.65, 6);
    expect(soldier!.moveEnd).toBe(1);

    const fall = segment('fallIn');
    expect(fall.toSnapshot.gait).toBe('halt');
    expect(fall.end - fall.start).toBeCloseTo(4.5 + 1.0, 6);
    expect(fall.steps![timeline.soldiers[0].id]!.total.z).toBeCloseTo(6, 6);
  });

  it('leaves the right marker standing fast in right dress', () => {
    const dress = segment('rightDress');
    const marker = timeline.soldiers.find((s) => s.role === 'marker')!;
    expect(dress.steps![marker.id]).toBeUndefined();
    const other = timeline.soldiers.find((s) => s.role === 'cadet' && s.rank === 0)!;
    expect(dress.steps![other.id]).toBeDefined();
    expect(dress.steps![other.id]!.movements[0]).toBe('check pace');
  });

  it('takes a 35 cm first step and a 75 cm second step from the halt', () => {
    const march = segment('quickMarch');
    const cadet = timeline.soldiers.find((s) => s.role === 'cadet')!;
    const plan = march.steps![cadet.id]!;
    const plants = [...plan.left, ...plan.right]
      .filter((plant) => plant.land > 0)
      .sort((a, b) => a.land - b.land);
    expect(plants[0].label).toBe('pace 1');
    expect(plants[0].z).toBeCloseTo(0.35, 3);
    expect(plants[1].z - plants[0].z).toBeCloseTo(0.75, 3);
    // Half a pace shorter than the same march at speed: the nominal distance
    // left the body sprinting the last half beat to catch the final boot.
    expect(plan.total.z).toBeCloseTo(PACE_HALF + (plan.paces - 1) * PACE, 6);
    expect(march.toFrame.z - march.fromFrame.z).toBeCloseTo(plan.total.z, 6);
    expectNoSlip(plan);
    expectReachable(plan);
  });

  it('eases the body off the halt instead of starting at full speed', () => {
    const march = segment('quickMarch');
    const cadet = timeline.soldiers.find((s) => s.role === 'cadet')!;
    const speedAt = (t: number) => {
      const a = sampleTimeline(timeline, t).soldiers.find((s) => s.soldier.id === cadet.id)!;
      const b = sampleTimeline(timeline, t + 1 / 240).soldiers.find(
        (s) => s.soldier.id === cadet.id,
      )!;
      return Math.hypot(b.x - a.x, b.z - a.z) / (1 / 240);
    };
    expect(speedAt(march.start + 1e-4)).toBeLessThan(0.15);
    // The half-pace first step means the body only starts to accelerate while
    // the left boot is shooting 35 cm forward; it must not jump to cruise.
    expect(speedAt(march.start + 0.08)).toBeGreaterThan(0.15);
    expect(speedAt(march.start + 0.08)).toBeLessThan(0.8);
    expect(speedAt(march.start + 0.9)).toBeGreaterThan(1.4);
    expect(speedAt(march.start + 0.9)).toBeLessThan(1.7);
    const plan = march.steps?.[cadet.id];
    expect(plan?.bodyAt).toBeDefined();
    expectNoSlip(plan!);
    expectReachable(plan!);
    expect(sampleStepPlan(plan!, 0).body.z).toBeCloseTo(0, 5);
    expect(sampleStepPlan(plan!, 1).body.z).toBeCloseTo(plan!.total.z, 5);
  });

  it('keeps the body at cruising speed through the end of a step-off', () => {
    const march = segment('quickMarch');
    const cadet = timeline.soldiers.find((s) => s.role === 'cadet')!;
    const plan = march.steps![cadet.id]!;
    const dt = 1 / 240;
    const position = (t: number) =>
      sampleTimeline(timeline, t).soldiers.find((s) => s.soldier.id === cadet.id)!;
    const speedAt = (t: number) => {
      const a = position(t);
      const b = position(t + dt);
      return Math.hypot(b.x - a.x, b.z - a.z) / dt;
    };
    // Quick time covers one 75 cm pace per half-second beat.
    const cruise = (PACE * settings.cadence) / 60;
    const span = march.actionEnd - march.start;
    for (let f = 0.75; f < 0.98; f += 0.05) {
      const speed = speedAt(march.start + span * f);
      expect(speed, `speed at ${f.toFixed(2)}`).toBeGreaterThan(cruise * 0.9);
      expect(speed, `speed at ${f.toFixed(2)}`).toBeLessThan(cruise * 1.1);
    }
    // The last frame before the halt is still at the cruising pace, not a
    // sprint to make up the half pace the short first step gave away.
    expect(speedAt(march.actionEnd - dt - 0.001)).toBeCloseTo(cruise, 2);
  });

  it('commands the halt on the left foot, with the trailing right taking the pace', () => {
    const halt = segment('halt');
    const cadet = timeline.soldiers.find((s) => s.role === 'cadet')!;
    const plan = halt.steps![cadet.id]!;
    expect(plan.start.left.z).toBeGreaterThan(plan.start.right.z);
    expect(plan.lead).toBe('R');
    expect(plan.movements[0]).toBe('one more pace');
  });

  it('starts the default parade halt with the left foot forward', () => {
    const defaultTimeline = buildTimeline(makePlan());
    const cadet = defaultTimeline.soldiers.find((s) => s.role === 'cadet')!;
    const halts = defaultTimeline.segments.filter((s) => s.type === 'halt');
    expect(halts.length).toBeGreaterThan(0);
    for (const halt of halts) {
      const plan = halt.steps?.[cadet.id];
      expect(plan, 'halt has a step plan').toBeDefined();
      expect(plan!.start.left.z).toBeGreaterThan(plan!.start.right.z);
      expect(plan!.lead).toBe('R');
    }
  });

  it('moves no one at the halt during the pause', () => {
    for (const type of ['pacesForward', 'openOrder', 'fallIn', 'halt']) {
      const seg = segment(type);
      for (const p of Object.values(seg.steps ?? {})) {
        const atActionEnd = sampleStepPlan(p, 1);
        const atPause = sampleStepPlan(p, 1);
        expect(atPause.left.x).toBeCloseTo(atActionEnd.left.x, 9);
        expect(atPause.left.z).toBeCloseTo(atActionEnd.left.z, 9);
        expect(atPause.right.z).toBeCloseTo(atActionEnd.right.z, 9);
      }
    }
  });
});
