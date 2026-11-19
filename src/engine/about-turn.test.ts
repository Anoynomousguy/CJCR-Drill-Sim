import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS, PACE_HALF } from './constants';
import { LEG, solveKnee } from './gait';
import { aboutTurnBodyAt, aboutTurnContact } from './aboutTurn';
import { buildTimeline, sampleTimeline } from './simulate';
import { sampleStepPlan } from './steps';
import { makeTurnPlan, turnFootwork, turnHeadingAt } from './turn';
import type { Plan } from './types';

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 6,
  squads: 2,
  ranks: 3,
  armed: false,
  colours: 0,
  commander: false,
  headingDeg: 0,
};

const roster = Array.from({ length: 6 }, (_, i) => ({ id: `cadet-${i}`, height: 1.78 }));

let n = 0;
const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: `${type}-${n++}`,
  type,
  params,
});

const timeline = buildTimeline({
  version: 1,
  name: 'about turn',
  settings,
  roster,
  programme: [
    move('attention'),
    move('quickMarch', { paces: 6 }),
    move('aboutTurnOnMarch'),
    move('quickMarch', { paces: 4 }),
    move('halt'),
  ],
});

const segment = (type: string) => timeline.segments.find((s) => s.type === type)!;

function aboutOf() {
  const seg = segment('aboutTurnOnMarch');
  const plan = seg.turn;
  if (!plan?.about) throw new Error('about turn has no plan');
  return { seg, plan, about: plan.about };
}

const worldFoot = (
  soldier: { x: number; z: number; heading: number },
  foot: { x: number; z: number },
) => {
  const cos = Math.cos(soldier.heading);
  const sin = Math.sin(soldier.heading);
  return { x: soldier.x + foot.x * cos + foot.z * sin, z: soldier.z - foot.x * sin + foot.z * cos };
};

describe('about turn on the march, count by count', () => {
  it('is given on the right foot and occupies the five manual counts', () => {
    const { seg, about } = aboutOf();
    expect(about.lead).toBe('R');
    expect(about.free).toBe('L');
    expect(about.start.right.z).toBeGreaterThan(about.start.left.z + 0.1);
    expect(about.counts.map((c) => c.key)).toEqual(['pace', 'in', 'pivot1', 'pivot2', 'step']);
    expect(about.counts.map((c) => c.count)).toEqual([1, 2, 3, 4, 5]);
    expect(seg.actionEnd - seg.start).toBeCloseTo(5 * BEAT, 6);
    const deg = (p: number) => Math.abs(about.turn.angle * (180 / Math.PI)) * turnHeadingAt(about.turn, p);
    expect(deg(0.4)).toBeCloseTo(0, 6);
    expect(deg(0.6)).toBeCloseTo(90, 6);
    expect(deg(0.8)).toBeCloseTo(180, 6);
    expect(deg(1)).toBeCloseTo(180, 6);
  });

  it('takes a half pace with the left and brings the right in to attention', () => {
    const { about } = aboutOf();
    const q = aboutTurnBodyAt(about, 0.2)!;
    expect(q.left.planted && q.right.planted).toBe(true);
    // The left boot has landed flat half a pace on.
    const freeBall0 = aboutTurnContact(about, 0, 'L', 'ball');
    const freeBall1 = aboutTurnContact(about, 0.2, 'L', 'ball');
    expect(freeBall1.z - freeBall0.z).toBeCloseTo(PACE_HALF, 1);
    expect(freeBall1.y).toBeCloseTo(0, 5);
    expect(aboutTurnContact(about, 0.2, 'L', 'heel').y).toBeCloseTo(0, 5);
    expect(q.left.pitch).toBeCloseTo(0, 5);

    // On the second count the right boot comes in beside the left, just clear
    // of the ground, to attention.
    const mid = aboutTurnBodyAt(about, 0.3)!;
    expect(mid.right.y).toBeGreaterThan(LEG.ankle + 0.01);
    const square = aboutTurnBodyAt(about, 0.4)!;
    expect(square.left.x).toBeCloseTo(LEG.standX, 6);
    expect(square.right.x).toBeCloseTo(-LEG.standX, 6);
    expect(square.left.z).toBeCloseTo(0, 6);
    expect(square.right.z).toBeCloseTo(0, 6);
    expect(square.left.y).toBeCloseTo(LEG.ankle, 6);
    expect(square.right.y).toBeCloseTo(LEG.ankle, 6);
    expect(square.right.planted).toBe(true);
  });

  it('pivots 90 on the right ball, then 90 on the left ball, each contact fixed', () => {
    const { about } = aboutOf();
    const rightBall = aboutTurnContact(about, 0.4, 'R', 'ball');
    expect(rightBall.y).toBeCloseTo(0, 6);
    for (const p of [0.45, 0.5, 0.55, 0.6]) {
      const c = aboutTurnContact(about, p, 'R', 'ball');
      expect(Math.hypot(c.x - rightBall.x, c.z - rightBall.z), `right ball ${p}`).toBeLessThan(0.001);
      expect(c.y, `right ball height ${p}`).toBeCloseTo(0, 6);
    }
    const leftBall = aboutTurnContact(about, 0.6, 'L', 'ball');
    expect(leftBall.y).toBeCloseTo(0, 6);
    for (const p of [0.65, 0.7, 0.75, 0.8]) {
      const c = aboutTurnContact(about, p, 'L', 'ball');
      expect(Math.hypot(c.x - leftBall.x, c.z - leftBall.z), `left ball ${p}`).toBeLessThan(0.001);
      expect(c.y, `left ball height ${p}`).toBeCloseTo(0, 6);
    }
    const deg = (p: number) => Math.abs(about.turn.angle * (180 / Math.PI)) * turnHeadingAt(about.turn, p);
    expect(deg(0.5)).toBeCloseTo(45, 6);
    expect(deg(0.7)).toBeCloseTo(135, 6);
  });

  it('bends the free knee, lowers it beside the pivot foot, and does not fold the leg up', () => {
    const { about } = aboutOf();
    let maxHip = 0;
    let maxKnee = 0;
    let maxAnkle = 0;
    // First pivot: the left knee is the one raised.
    for (let i = 0; i <= 100; i += 1) {
      const p = 0.4 + (i / 100) * 0.2;
      const body = aboutTurnBodyAt(about, p)!;
      const free = body.left;
      expect(Math.abs(Math.abs(free.x) - LEG.standX), `left beside ${p}`).toBeLessThan(1e-6);
      expect(Math.abs(free.z), `left fore-aft ${p}`).toBeLessThan(1e-6);
      maxAnkle = Math.max(maxAnkle, free.y);
    }
    // Second pivot: the right knee is the one raised.
    for (let i = 0; i <= 100; i += 1) {
      const p = 0.6 + (i / 100) * 0.2;
      const body = aboutTurnBodyAt(about, p)!;
      const free = body.right;
      expect(Math.abs(Math.abs(free.x) - LEG.standX), `right beside ${p}`).toBeLessThan(1e-6);
      expect(Math.abs(free.z), `right fore-aft ${p}`).toBeLessThan(1e-6);
      maxAnkle = Math.max(maxAnkle, free.y);
    }
    for (const p of [0.5, 0.7]) {
      const body = aboutTurnBodyAt(about, p)!;
      for (const side of ['left', 'right'] as const) {
        const foot = body[side];
        const hip: [number, number, number] = [side === 'left' ? LEG.hipX : -LEG.hipX, body.hipY, 0];
        const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
        maxHip = Math.max(maxHip, sol.hipFlexion);
        maxKnee = Math.max(maxKnee, sol.kneeFlexion);
      }
    }
    // "Bend the knee" is a knee lift, not the slow-time thigh-parallel pose.
    expect(maxHip).toBeLessThan(55);
    expect(maxKnee).toBeLessThan(80);
    expect(maxAnkle).toBeLessThan(0.2);
    // The free boot lands beside the pivot boot at the end of each pivot.
    const after1 = aboutTurnBodyAt(about, 0.6)!;
    expect(after1.left.y).toBeCloseTo(LEG.ankle, 6);
    expect(after1.left.planted).toBe(true);
    const after2 = aboutTurnBodyAt(about, 0.8)!;
    expect(after2.right.y).toBeCloseTo(LEG.ankle, 6);
    expect(after2.right.planted).toBe(true);
  });

  it('steps off half a pace with the left in the new direction', () => {
    const { about } = aboutOf();
    const end = aboutTurnBodyAt(about, 1)!;
    expect(end.left.planted && end.right.planted).toBe(true);
    expect(end.left.pitch).toBeCloseTo(0, 6);
    expect(end.right.pitch).toBeCloseTo(0, 6);
    expect(end.left.y).toBeCloseTo(LEG.ankle, 6);
    expect(end.right.y).toBeCloseTo(LEG.ankle, 6);
    expect(Math.abs(end.left.x)).toBeCloseTo(LEG.standX, 6);
    expect(Math.abs(end.right.x)).toBeCloseTo(LEG.standX, 6);
    // The body is over the new leading (left) boot and the right is a half
    // pace behind it in the new facing.
    expect(end.left.z).toBeCloseTo(0, 6);
    expect(end.right.z).toBeCloseTo(-PACE_HALF, 6);
    expect(about.advance).toBeGreaterThan(0.1);
    expect(about.advance).toBeLessThan(0.6);
  });

  it('hands the march into the about turn and the next march out of it without a snap', () => {
    const { seg } = aboutOf();
    const id = timeline.soldiers[0].id;
    const before = sampleTimeline(timeline, seg.start - 1e-4);
    const atStart = sampleTimeline(timeline, seg.start + 1e-4);
    const atEnd = sampleTimeline(timeline, seg.actionEnd - 1e-4);
    const after = sampleTimeline(timeline, seg.actionEnd + 1e-4);
    const marchBefore = before.steps?.[id];
    expect(marchBefore).toBeDefined();
    const beforeEnd = sampleStepPlan(marchBefore!, 1);
    const nextPlan = after.steps?.[id];
    expect(nextPlan).toBeDefined();
    const nextStart = sampleStepPlan(nextPlan!, 0);
    const sBefore = before.soldiers.find((s) => s.soldier.id === id)!;
    const sStart = atStart.soldiers.find((s) => s.soldier.id === id)!;
    const sEnd = atEnd.soldiers.find((s) => s.soldier.id === id)!;
    const sAfter = after.soldiers.find((s) => s.soldier.id === id)!;
    for (const side of ['left', 'right'] as const) {
      const w0 = worldFoot(sBefore, beforeEnd[side]);
      const w1 = worldFoot(sStart, atStart.turnBody![side]);
      const w2 = worldFoot(sEnd, atEnd.turnBody![side]);
      const w3 = worldFoot(sAfter, nextStart[side]);
      expect(Math.hypot(w1.x - w0.x, w1.z - w0.z), `into about ${side}`).toBeLessThan(0.01);
      expect(Math.hypot(w3.x - w2.x, w3.z - w2.z), `out of about ${side}`).toBeLessThan(0.01);
    }
    const hipAt = (t: number) => {
      const sample = sampleTimeline(timeline, t);
      const step = sample.steps?.[id];
      return step ? sampleStepPlan(step, sample.progress).hipY : sample.turnBody?.hipY ?? NaN;
    };
    expect(Math.abs(hipAt(seg.start + 1e-4) - hipAt(seg.start - 1e-4))).toBeLessThan(0.002);
    expect(Math.abs(hipAt(seg.actionEnd + 1e-4) - hipAt(seg.actionEnd - 1e-4))).toBeLessThan(0.002);
    expect(timeline.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
  });

  it('turns each cadet on their own boots instead of wheeling the squad about its centre', () => {
    const { seg, about } = aboutOf();
    const a = sampleTimeline(timeline, seg.start + 1e-4);
    const b = sampleTimeline(timeline, seg.actionEnd - 1e-4);
    for (const s of b.soldiers) {
      const before = a.soldiers.find((x) => x.soldier.id === s.soldier.id)!;
      expect(Math.abs(s.heading - before.heading)).toBeCloseTo(Math.PI, 4);
    }
    const moves = b.soldiers.map((s) => {
      const before = a.soldiers.find((x) => x.soldier.id === s.soldier.id)!;
      return Math.hypot(s.x - before.x, s.z - before.z);
    });
    // Everyone turns where they stand and advances by the same body offset;
    // an orbit about the formation centre would move the outer files further.
    expect(Math.max(...moves) - Math.min(...moves)).toBeLessThan(0.02);
    expect(moves[0]).toBeCloseTo(about.advance, 3);
    const startGap = Math.hypot(a.soldiers[0].x - a.soldiers[1].x, a.soldiers[0].z - a.soldiers[1].z);
    const endGap = Math.hypot(b.soldiers[0].x - b.soldiers[1].x, b.soldiers[0].z - b.soldiers[1].z);
    expect(endGap).toBeCloseTo(startGap, 6);
  });

  it('cuts the arms as the command foot comes in and keeps the trunk steady', () => {
    const plan = makeTurnPlan('aboutMarch', 180, 'right');
    expect(turnFootwork(plan, 0.1).armCut).toBeCloseTo(0, 6);
    for (const p of [0.4, 0.5, 0.6, 0.7, 0.8]) {
      const fw = turnFootwork(plan, p);
      expect(fw.armCut, `arms ${p}`).toBeGreaterThan(0.9);
      expect(fw.chestYaw, `chest ${p}`).toBe(0);
      expect(fw.headYaw, `head ${p}`).toBe(0);
      expect(fw.lean, `lean ${p}`).toBe(0);
    }
    expect(turnFootwork(plan, 0.99).armCut).toBeLessThan(0.2);
  });
});
