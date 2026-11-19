import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS, PACE } from './constants';
import { LEG, solveKnee } from './gait';
import { marchTurnBodyAt, marchTurnContact } from './marchTurn';
import { buildTimeline, sampleTimeline } from './simulate';
import { hipHeightFor, sampleStepPlan } from './steps';
import { makeTurnPlan, turnFootwork, turnHeadingAt } from './turn';
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

// The saved parade's marching section: six paces, right turn, six paces, left
// turn, four paces, halt. The two on-march turns are the subject.
const programme: Plan['programme'] = [
  move('attention'),
  move('rightDress'),
  move('eyesFront'),
  move('slopeArms'),
  move('quickMarch', { paces: 6 }),
  move('rightTurnOnMarch'),
  move('quickMarch', { paces: 6 }),
  move('leftTurnOnMarch'),
  move('quickMarch', { paces: 4 }),
  move('halt'),
  move('aboutTurn'),
  move('quickMarch', { paces: 4 }),
  move('halt'),
  move('orderArms'),
  move('rightIncline'),
];

const plan: Plan = { version: 1, name: 'march turns', settings, roster, programme };
const timeline = buildTimeline(plan);
const segment = (type: string) => timeline.segments.find((s) => s.type === type)!;

function turnOf(type: string) {
  const seg = segment(type);
  const t = seg.turn;
  if (!t?.march) throw new Error(`${type} has no march plan`);
  return { seg, plan: t, march: t.march };
}

const worldFoot = (
  soldier: { x: number; z: number; heading: number },
  foot: { x: number; z: number },
) => {
  const cos = Math.cos(soldier.heading);
  const sin = Math.sin(soldier.heading);
  return { x: soldier.x + foot.x * cos + foot.z * sin, z: soldier.z - foot.x * sin + foot.z * cos };
};

type Timeline = ReturnType<typeof buildTimeline>;
type Segment = Timeline['segments'][number];

/**
 * Every boot landing in a marching segment, with its world position. The boots
 * already down at the segment's first frame are the hand-off pose, not
 * footfalls, so they are not counted.
 */
function plantTimes(tl: Timeline, seg: Segment, id: string) {
  const out: { t: number; side: 'left' | 'right'; x: number; z: number; heading: number }[] = [];
  const was = { left: false, right: false };
  const first = seg.start + 1e-6;
  for (let t = first; t <= seg.actionEnd - 1e-6; t += 0.002) {
    const sample = sampleTimeline(tl, t);
    const plan = sample.steps?.[id];
    if (!plan) continue;
    const step = sampleStepPlan(plan, sample.progress);
    const soldier = sample.soldiers.find((s) => s.soldier.id === id);
    if (!soldier) continue;
    for (const side of ['left', 'right'] as const) {
      const planted = step[side].planted;
      if (planted && !was[side] && t > first + 0.02) {
        const w = worldFoot(soldier, step[side]);
        out.push({ t, side, x: w.x, z: w.z, heading: soldier.heading });
      }
      was[side] = planted;
    }
  }
  return out;
}

const aheadOf = (a: { x: number; z: number }, b: { x: number; z: number }, heading: number) =>
  (a.x - b.x) * Math.sin(heading) + (a.z - b.z) * Math.cos(heading);

describe('turns on the march, count by count', () => {
  it('gives the right turn on the left foot and the left turn on the right', () => {
    const right = turnOf('rightTurnOnMarch');
    expect(right.plan.pivot).toBe('R');
    expect(right.plan.outside).toBe('L');
    expect(right.march.start.left.z).toBeGreaterThan(right.march.start.right.z + 0.2);
    expect(right.march.counts.map((c) => c.key)).toEqual(['check', 'pivot', 'step']);
    expect(right.march.counts.map((c) => c.count)).toEqual([1, 2, 3]);
    expect(right.seg.actionEnd - right.seg.start).toBeCloseTo(3 * BEAT, 6);

    const left = turnOf('leftTurnOnMarch');
    expect(left.plan.pivot).toBe('L');
    expect(left.plan.outside).toBe('R');
    expect(left.march.start.right.z).toBeGreaterThan(left.march.start.left.z + 0.2);
  });

  it('holds the free ball through the check, the pivot ball through the pivot, then the landed foot', () => {
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch'] as const) {
      const { march } = turnOf(type);
      const pivot = march.pivot;
      const free = march.free;
      const moving = pivot === 'R' ? 'L' : 'R';

      // ONE: the support foot is the command foot; its ball is fixed while its
      // heel rises. The other foot takes its half pace.
      const freeBall0 = marchTurnContact(march, 0, free, 'ball');
      expect(freeBall0.y).toBeCloseTo(0, 6);
      for (let i = 1; i <= 30; i += 1) {
        const p = (i / 30) / 3;
        const c = marchTurnContact(march, p, free, 'ball');
        expect(Math.hypot(c.x - freeBall0.x, c.z - freeBall0.z), `${type} free ball ${p}`).toBeLessThan(0.001);
        expect(c.y).toBeLessThan(0.001);
      }

      // TWO: pivot on the ball of the pivot foot. That ball is a world contact.
      const pivotBall = marchTurnContact(march, 1 / 3, pivot, 'ball');
      expect(pivotBall.y).toBeCloseTo(0, 6);
      for (let i = 1; i <= 30; i += 1) {
        const p = 1 / 3 + (i / 30) / 3;
        const c = marchTurnContact(march, p, pivot, 'ball');
        expect(Math.hypot(c.x - pivotBall.x, c.z - pivotBall.z), `${type} pivot ball ${p}`).toBeLessThan(0.001);
        expect(c.y).toBeLessThan(0.001);
      }

      // THREE: the landed foot is down and carries the body while the pivot
      // foot shoots forward. Both its ball and heel stay still.
      const landedBall = marchTurnContact(march, 2 / 3, moving, 'ball');
      const landedHeel = marchTurnContact(march, 2 / 3, moving, 'heel');
      expect(landedBall.y).toBeCloseTo(0, 6);
      expect(landedHeel.y).toBeCloseTo(0, 6);
      for (let i = 1; i <= 30; i += 1) {
        const p = 2 / 3 + (i / 30) / 3;
        const b = marchTurnContact(march, p, moving, 'ball');
        const h = marchTurnContact(march, p, moving, 'heel');
        expect(Math.hypot(b.x - landedBall.x, b.z - landedBall.z), `${type} landed ball ${p}`).toBeLessThan(0.001);
        expect(Math.hypot(h.x - landedHeel.x, h.z - landedHeel.z), `${type} landed heel ${p}`).toBeLessThan(0.001);
        expect(b.y).toBeLessThan(0.001);
        expect(h.y).toBeLessThan(0.001);
      }

      const body = marchTurnBodyAt(march, 2 / 3)!;
      expect(body.left.planted && body.right.planted).toBe(true);
    }
  });

  it('turns exactly 90 degrees during the pivot, not during the check or step', () => {
    for (const [type, sign] of [
      ['rightTurnOnMarch', -1],
      ['leftTurnOnMarch', 1],
    ] as const) {
      const { plan: turn } = turnOf(type);
      expect(turnHeadingAt(turn, 0)).toBe(0);
      expect(turnHeadingAt(turn, 1 / 3)).toBe(0);
      expect(turnHeadingAt(turn, 1 / 3 + 1e-6)).toBeGreaterThanOrEqual(0);
      expect(turnHeadingAt(turn, 2 / 3)).toBe(1);
      expect(turnHeadingAt(turn, 1)).toBe(1);
      const deg = (turn.angle * 180) / Math.PI;
      expect(Math.sign(deg)).toBe(sign);
      expect(Math.abs(deg)).toBeCloseTo(90, 6);
    }
  });

  it('finishes the half pace with the shot foot and leaves the free foot beside it', () => {
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch'] as const) {
      const { march } = turnOf(type);
      const { pivot, free } = march;
      const end = marchTurnBodyAt(march, 1)!;
      const pivotFoot = pivot === 'L' ? end.left : end.right;
      const freeFoot = free === 'L' ? end.left : end.right;
      expect(pivotFoot.planted && freeFoot.planted).toBe(true);
      expect(pivotFoot.pitch).toBeCloseTo(0, 6);
      expect(freeFoot.pitch).toBeCloseTo(0, 6);
      // The shot (pivot-side) foot is half a pace ahead of the landed foot.
      const ahead = pivotFoot.z - freeFoot.z;
      expect(ahead).toBeGreaterThan(0.3);
      expect(ahead).toBeLessThan(0.45);
      expect(pivotFoot.y).toBeCloseTo(LEG.ankle, 6);
      expect(freeFoot.y).toBeCloseTo(LEG.ankle, 6);
      expect(march.advance).toBeGreaterThan(0.1);
      expect(Math.abs(end.x) + Math.abs(end.z)).toBeGreaterThan(0.1);
    }
  });

  it('holds the body and head steady and cuts the arms on the pivot', () => {
    const turn = makeTurnPlan('march', 90, 'right');
    for (const p of [0.4, 0.45, 0.5, 0.55, 0.6]) {
      const fw = turnFootwork(turn, p);
      expect(fw.chestYaw, `chest ${p}`).toBe(0);
      expect(fw.headYaw, `head ${p}`).toBe(0);
      expect(fw.lean, `lean ${p}`).toBe(0);
      expect(fw.armCut, `arms ${p}`).toBeGreaterThan(0.9);
    }
    expect(turnFootwork(turn, 1 / 3).armCut).toBeCloseTo(0, 6);
    expect(turnFootwork(turn, 2 / 3).armCut).toBeCloseTo(0, 6);
  });

  it('turns each soldier about its own boot contact, not around the formation centre', () => {
    const right = turnOf('rightTurnOnMarch');
    const a = sampleTimeline(timeline, right.seg.start + right.seg.actionEnd - right.seg.start);
    const b = sampleTimeline(timeline, right.seg.start);
    const startSlots = b.soldiers.map((s) => ({ id: s.soldier.id, x: s.x, z: s.z, heading: s.heading }));
    for (const s of a.soldiers) {
      const before = startSlots.find((x) => x.id === s.soldier.id)!;
      // Each person advances by his own turn's body offset, but the formation
      // does not orbit: the step between slots is the same at both ends.
      expect(Math.abs(s.heading - before.heading)).toBeCloseTo(Math.PI / 2, 4);
    }
    const start = a.soldiers[0];
    const end = a.soldiers[1];
    const beforeStart = b.soldiers[0];
    const beforeEnd = b.soldiers[1];
    const spacingStart = Math.hypot(beforeStart.x - beforeEnd.x, beforeStart.z - beforeEnd.z);
    const spacingEnd = Math.hypot(start.x - end.x, start.z - end.z);
    expect(spacingEnd).toBeCloseTo(spacingStart, 6);
  });

  it('hands the previous march to the turn and the turn to the next march without a snap', () => {
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch'] as const) {
      const { seg } = turnOf(type);
      const before = sampleTimeline(timeline, seg.start - 1e-4);
      const atStart = sampleTimeline(timeline, seg.start + 1e-4);
      const atEnd = sampleTimeline(timeline, seg.actionEnd - 1e-4);
      const after = sampleTimeline(timeline, seg.actionEnd + 1e-4);
      const marchBefore = before.steps?.[timeline.soldiers[0].id];
      expect(marchBefore, `${type} preceding march plan`).toBeDefined();
      const beforeEnd = sampleStepPlan(marchBefore!, 1);
      for (const id of [timeline.soldiers[0].id, timeline.soldiers[1].id, timeline.soldiers[timeline.soldiers.length - 1].id]) {
        const sBefore = before.soldiers.find((s) => s.soldier.id === id)!;
        const sStart = atStart.soldiers.find((s) => s.soldier.id === id)!;
        const sTurnEnd = atEnd.soldiers.find((s) => s.soldier.id === id)!;
        const sAfter = after.soldiers.find((s) => s.soldier.id === id)!;
        const startFeet = atStart.turnBody!;
        const endFeet = atEnd.turnBody!;
        for (const side of ['left', 'right'] as const) {
          const w0 = worldFoot(sBefore, beforeEnd[side]);
          const w1 = worldFoot(sStart, startFeet[side]);
          const w2 = worldFoot(sTurnEnd, endFeet[side]);
          const afterPlan = after.steps?.[id];
          const next = afterPlan ? sampleStepPlan(afterPlan, 0) : null;
          expect(next, `${type} ${id} next march plan`).not.toBeNull();
          const w3 = worldFoot(sAfter, next![side]);
          expect(Math.hypot(w1.x - w0.x, w1.z - w0.z), `${type} ${id} ${side} into turn`).toBeLessThan(0.01);
          expect(Math.hypot(w3.x - w2.x, w3.z - w2.z), `${type} ${id} ${side} out of turn`).toBeLessThan(0.01);
        }
      }
    }
  });

  it('hands the final march to the halt and the halt to the about turn', () => {
    const halt = segment('halt');
    const before = sampleTimeline(timeline, halt.start - 1e-4);
    const after = sampleTimeline(timeline, halt.start + 1e-4);
    for (const id of [timeline.soldiers[0].id, timeline.soldiers[timeline.soldiers.length - 1].id]) {
      const sBefore = before.soldiers.find((s) => s.soldier.id === id)!;
      const sAfter = after.soldiers.find((s) => s.soldier.id === id)!;
      const march = before.steps?.[id];
      expect(march).toBeDefined();
      const end = sampleStepPlan(march!, 1);
      const start = sampleStepPlan(halt.steps![id], 0);
      expect(start.hipY, `halt ${id} hip`).toBeGreaterThan(0.85);
      for (const side of ['left', 'right'] as const) {
        const a = worldFoot(sBefore, end[side]);
        const b = worldFoot(sAfter, start[side]);
        expect(Math.hypot(a.x - b.x, a.z - b.z), `halt ${id} ${side}`).toBeLessThan(0.01);
      }
    }
  });

  it('keeps most of its marching speed through the pivot', () => {
    const speedAt = (type: string, p: number) => {
      const seg = segment(type);
      const t = seg.start + (seg.actionEnd - seg.start) * p;
      const dt = 0.001;
      const a = sampleTimeline(timeline, t - dt);
      const b = sampleTimeline(timeline, t + dt);
      return Math.hypot(
        b.soldiers[0].x - a.soldiers[0].x,
        b.soldiers[0].z - a.soldiers[0].z,
      ) / (2 * dt);
    };
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch']) {
      // An absolute floor let a pivot crawl at a third of the check pace pass.
      // Compare it with the check itself instead: halving the body's speed
      // through the pivot must fail, however slow the march is.
      const check = speedAt(type, 0.25);
      const pivot = speedAt(type, 0.5);
      expect(check, `${type} check speed`).toBeGreaterThan(0.6);
      expect(pivot, `${type} pivot ${pivot.toFixed(2)} vs check ${check.toFixed(2)}`).toBeGreaterThan(
        check * 0.6,
      );
    }
  });

  it('keeps the halt body moving after its old mid-action stop', () => {
    const halt = segment('halt');
    const speedAt = (p: number) => {
      const t = halt.start + (halt.actionEnd - halt.start) * p;
      const dt = 0.001;
      const a = sampleTimeline(timeline, t - dt);
      const b = sampleTimeline(timeline, t + dt);
      return Math.hypot(
        b.soldiers[0].x - a.soldiers[0].x,
        b.soldiers[0].z - a.soldiers[0].z,
      ) / (2 * dt);
    };
    expect(speedAt(0.25)).toBeGreaterThan(0.1);
    expect(speedAt(0.75)).toBeGreaterThan(0.1);
  });

  it('builds a contact-fixed plan for both turns in the saved programme', () => {
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch']) {
      const seg = segment(type);
      expect(seg.turn?.march, type).toBeDefined();
      expect(seg.actionEnd - seg.start).toBeCloseTo(3 * BEAT, 6);
    }
    expect(segment('quickMarch').steps).toBeDefined();
    expect(timeline.warnings.filter((w) => w.severity === 'warn' || w.severity === 'error')).toEqual([]);
  });

  it('skims the outside boot through the pivot instead of raising the knee', () => {
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch'] as const) {
      const { march } = turnOf(type);
      const side = march.free;
      let ankle = 0;
      let thigh = 0;
      // Only the pivot (count two): during the check the outside leg trails
      // behind the body, which is correct but reads as a negative hip angle.
      for (let i = 0; i <= 200; i += 1) {
        const p = i / 200;
        if (p < 1 / 3 || p > 2 / 3) continue;
        const body = marchTurnBodyAt(march, p)!;
        const foot = side === 'L' ? body.left : body.right;
        ankle = Math.max(ankle, foot.y);
        const hip: [number, number, number] = [side === 'L' ? LEG.hipX : -LEG.hipX, body.hipY, 0];
        thigh = Math.max(thigh, solveKnee(hip, [foot.x, foot.y, foot.z]).hipFlexion);
      }
      // "Lift the outside knee" is a skim, not a march step: 13 cm of clearance
      // folded the knee 68 degrees with the thigh at 40, so the turn read as
      // the leg coming up under the body. With only the 5 cm skim and no
      // lateral bulge the thigh peaks at 28.3 degrees, still far below that.
      expect(thigh, type).toBeLessThan(32);
      expect(ankle, type).toBeLessThan(0.19);
    }
  });

  it('swings every boot continuously through the march after a turn', () => {
    const dt = 1 / 240;
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch'] as const) {
      const { seg } = turnOf(type);
      const march = timeline.segments[timeline.segments.indexOf(seg) + 1];
      expect(march.type, `${type} next segment`).toBe('quickMarch');
      for (const id of [
        timeline.soldiers[0].id,
        timeline.soldiers[1].id,
        timeline.soldiers[timeline.soldiers.length - 1].id,
      ]) {
        const rows: Record<'L' | 'R', { x: number; y: number; z: number; pitch: number; planted: boolean }[]> = {
          L: [],
          R: [],
        };
        let heading = 0;
        for (let t = march.start; t <= march.end - 1e-4; t += dt) {
          const sample = sampleTimeline(timeline, t);
          const plan = sample.steps?.[id];
          if (!plan) continue;
          const soldier = sample.soldiers.find((s) => s.soldier.id === id)!;
          heading = soldier.heading;
          const step = sampleStepPlan(plan, sample.progress);
          for (const side of ['L', 'R'] as const) {
            const foot = side === 'L' ? step.left : step.right;
            const world = worldFoot(soldier, foot);
            rows[side].push({ ...world, y: foot.y, pitch: foot.pitch, planted: foot.planted });
          }
        }
        const fx = Math.sin(heading);
        const fz = Math.cos(heading);
        for (const side of ['L', 'R'] as const) {
          const list = rows[side];
          let swings = 0;
          let current: {
            proj: number;
            last: (typeof list)[number];
            maxStep: number;
            firstPitch: number;
            fromPitch: number;
          } | null = null;
          for (let i = 1; i < list.length; i += 1) {
            const prev = list[i - 1];
            const now = list[i];
            if (!now.planted) {
              const proj = (now.x - list[0].x) * fx + (now.z - list[0].z) * fz;
              if (!current) {
                current = {
                  proj,
                  last: prev,
                  maxStep: 0,
                  firstPitch: now.pitch,
                  fromPitch: prev.pitch,
                };
              }
              const jump = Math.hypot(now.x - current.last.x, now.z - current.last.z);
              current.maxStep = Math.max(current.maxStep, jump);
              expect(proj, `${type} ${id} ${side} backward swing at ${i}`).toBeGreaterThanOrEqual(current.proj - 1e-4);
              current.proj = proj;
              current.last = now;
            } else if (current) {
              const landingJump = Math.hypot(now.x - current.last.x, now.z - current.last.z);
              expect(landingJump, `${type} ${id} ${side} touchdown snap`).toBeLessThan(0.005);
              expect(current.maxStep, `${type} ${id} ${side} swing jump`).toBeLessThan(0.04);
              // The swing must lift off at the pitch the stance ended on. A
              // boot that was rolled up on the heel and then snapped flat at
              // toe-off is the visible half-step jerk at every plant.
              expect(
                Math.abs(current.firstPitch - current.fromPitch),
                `${type} ${id} ${side} toe snap ${current.firstPitch.toFixed(1)} from ${current.fromPitch.toFixed(1)}`,
              ).toBeLessThan(2);
              expect(current.last.y, `${type} ${id} ${side} swing below ground`).toBeGreaterThan(LEG.ankle - 0.002);
              swings += 1;
              current = null;
            }
          }
          expect(swings, `${type} ${id} ${side} swung`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('lands one boot per beat, a full pace apart, across every turn exit', () => {
    // A turn ends on a footfall. If the next march starts from a generic
    // half-beat plan, its first boot lands only half a beat after that
    // footfall and the squad takes a quick little step out of every turn.
    // The cadence must stay one boot per quick-time beat across the seam.
    let m = 1000;
    const mv = (type: string, params: Record<string, number | string> = {}) => ({
      id: `about-${type}-${m++}`,
      type,
      params,
    });
    const aboutTimeline = buildTimeline({
      version: 1,
      name: 'about seam',
      settings,
      roster,
      programme: [
        mv('attention'),
        mv('rightDress'),
        mv('eyesFront'),
        mv('slopeArms'),
        mv('quickMarch', { paces: 6 }),
        mv('aboutTurnOnMarch'),
        mv('quickMarch', { paces: 4 }),
        mv('halt'),
      ],
    });
    const cases: { label: string; tl: Timeline; type: string }[] = [
      { label: 'right turn', tl: timeline, type: 'rightTurnOnMarch' },
      { label: 'left turn', tl: timeline, type: 'leftTurnOnMarch' },
      { label: 'about turn', tl: aboutTimeline, type: 'aboutTurnOnMarch' },
    ];
    for (const { label, tl, type } of cases) {
      const turn = tl.segments.find((s) => s.type === type)!;
      const march = tl.segments[tl.segments.indexOf(turn) + 1];
      expect(march.type, `${label} next segment`).toBe('quickMarch');
      expect(march.leadIn, `${label} must use the post-turn phase`).toBe(true);
      const id = tl.soldiers[0].id;
      const lands = plantTimes(tl, march, id);
      expect(lands.length, `${label} footfalls`).toBeGreaterThan(2);
      // The turn's last boot landed on its final beat; the next boot is a full
      // beat later, not half a beat.
      expect(lands[0].t - turn.actionEnd, `${label} seam interval`).toBeCloseTo(BEAT, 2);
      for (let i = 1; i < lands.length; i += 1) {
        expect(lands[i].t - lands[i - 1].t, `${label} beat ${i}`).toBeCloseTo(BEAT, 2);
        expect(
          aheadOf(lands[i], lands[i - 1], lands[i].heading),
          `${label} pace ${i}`,
        ).toBeCloseTo(PACE, 1);
      }

      // The boot that landed on the turn's last beat (the march turn's pivot
      // step-out, the about's closing step-off) and the first boot of the
      // march are a whole pace apart, and on opposite feet.
      const lastTurnFoot = turn.turn?.march?.pivot ?? turn.turn?.about?.free;
      expect(lastTurnFoot, `${label} last foot`).toBeTruthy();
      const atEnd = sampleTimeline(tl, turn.actionEnd - 1e-4);
      const soldier = atEnd.soldiers.find((s) => s.soldier.id === id)!;
      const last = lastTurnFoot === 'L' ? 'left' : 'right';
      const lastFoot = atEnd.turnBody![last];
      const w = worldFoot(soldier, lastFoot);
      expect(lands[0].side, `${label} first boot`).toBe(last === 'left' ? 'right' : 'left');
      expect(aheadOf(lands[0], w, lands[0].heading), `${label} seam pace`).toBeCloseTo(PACE, 1);
    }
  });

  it('eases the pelvis out of each turn without a seam step or a pop', () => {
    const hipAt = (t: number) => {
      const sample = sampleTimeline(timeline, t);
      const id = timeline.soldiers[0].id;
      const plan = sample.steps?.[id];
      return plan ? sampleStepPlan(plan, sample.progress).hipY : sample.turnBody?.hipY ?? NaN;
    };
    for (const type of ['rightTurnOnMarch', 'leftTurnOnMarch'] as const) {
      const { seg } = turnOf(type);
      expect(Math.abs(hipAt(seg.start + 1e-4) - hipAt(seg.start - 1e-4)), `${type} start seam`).toBeLessThan(0.001);
      expect(Math.abs(hipAt(seg.actionEnd + 1e-4) - hipAt(seg.actionEnd - 1e-4)), `${type} end seam`).toBeLessThan(0.001);

      const t0 = seg.actionEnd + 0.001;
      let prev = hipAt(t0);
      let maxRise = 0;
      for (let t = t0 + 1 / 240; t <= t0 + 0.3; t += 1 / 240) {
        const hip = hipAt(t);
        maxRise = Math.max(maxRise, (hip - prev) * 240);
        prev = hip;
      }
      expect(maxRise, `${type} pelvis rise`).toBeLessThan(0.7);
      expect(hipAt(t0 + 0.05) - hipAt(t0), `${type} pelvis rise in 50 ms`).toBeLessThan(0.04);

      // The limiter may only delay the reach cap; it may never lift the body
      // past either boot's reach.
      for (let t = t0; t <= t0 + 0.3; t += 0.01) {
        const sample = sampleTimeline(timeline, t);
        const id = timeline.soldiers[0].id;
        const plan = sample.steps?.[id];
        const step = plan ? sampleStepPlan(plan, sample.progress) : null;
        const feet = step ?? sample.turnBody;
        if (!feet) continue;
        const hip = step ? step.hipY : sample.turnBody!.hipY;
        expect(hip, `${type} pelvis overreach`).toBeLessThanOrEqual(hipHeightFor(feet.left, feet.right) + 1e-6);
      }

      const before = sampleTimeline(timeline, seg.actionEnd - 0.001);
      const after = sampleTimeline(timeline, seg.actionEnd + 0.001);
      const id = timeline.soldiers[0].id;
      const a = before.soldiers.find((s) => s.soldier.id === id)!;
      const b = after.soldiers.find((s) => s.soldier.id === id)!;
      expect(Math.hypot(b.x - a.x, b.z - a.z) / 0.002, `${type} exit speed`).toBeGreaterThan(1.2);
    }
  });
});
