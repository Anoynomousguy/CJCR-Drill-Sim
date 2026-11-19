import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../engine/constants';
import { LEG } from '../engine/gait';
import { marchTurnBodyAt } from '../engine/marchTurn';
import { buildTimeline } from '../engine/simulate';
import { turnHeadingAt, type TurnPlan } from '../engine/turn';
import type { Plan, Snapshot } from '../engine/types';
import { createFigure, type Figure, type FigurePalette } from './figure';
import { UNIFORMS } from '../engine/constants';

const palette = UNIFORMS.army as unknown as FigurePalette;

const QUICK: Snapshot = {
  posture: 'attention',
  weapon: 'none',
  colour: 'none',
  gait: 'quick',
  eyes: 'front',
  headdress: 'worn',
  spacing: 'close',
};

const CONTACT = {
  heel: new THREE.Vector3(0, -LEG.ankle, -LEG.heelLever),
  ball: new THREE.Vector3(0, -LEG.ankle, LEG.mtp),
};

function bootContact(fig: Figure, side: 'L' | 'R', which: 'heel' | 'ball'): THREE.Vector3 {
  const foot = fig.group.getObjectByName(`foot.${side}`);
  if (!foot) throw new Error(`no foot.${side}`);
  fig.group.updateMatrixWorld(true);
  return foot.localToWorld(CONTACT[which].clone());
}

function drive(fig: Figure, plan: TurnPlan, progress: number) {
  const march = plan.march;
  if (!march) throw new Error('no march turn');
  const body = marchTurnBodyAt(march, progress);
  if (!body) throw new Error('no march turn body');
  const heading = plan.angle * turnHeadingAt(plan, progress);
  fig.setTransform(body.x, body.z, heading);
  fig.animate({
    from: QUICK,
    to: QUICK,
    u: 1,
    gait: 'quick',
    stride: 0,
    time: progress,
    eyes: 'front',
    headdress: 'worn',
    feet: { left: body.left, right: body.right, hipY: body.hipY },
    turn: { plan, progress },
  });
  return body;
}

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

let n = 0;
const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: `${type}-${n++}`,
  type,
  params,
});

const timeline = buildTimeline({
  version: 1,
  name: 'march turn rig',
  settings,
  roster: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, height: 1.78 })),
  programme: [
    move('attention'),
    move('quickMarch', { paces: 6 }),
    move('rightTurnOnMarch'),
    move('quickMarch', { paces: 6 }),
    move('leftTurnOnMarch'),
    move('quickMarch', { paces: 4 }),
    move('halt'),
  ],
});

const turnOf = (type: string): TurnPlan => {
  const seg = timeline.segments.find((s) => s.type === type)!;
  if (!seg.turn?.march) throw new Error(`${type} has no march plan`);
  return seg.turn;
};

describe('turns on the march on the live rig', () => {
  it('keeps the check-foot ball and the pivot-foot ball on their contacts', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = turnOf('rightTurnOnMarch');
    const march = plan.march!;

    // ONE: the free (left) ball is the support contact while its heel rises.
    drive(fig, plan, 0);
    const freeBall = bootContact(fig, march.free, 'ball');
    expect(freeBall.y).toBeCloseTo(0, 2);
    for (const p of [0.06, 0.13, 0.22, 0.3, 1 / 3]) {
      drive(fig, plan, p);
      const c = bootContact(fig, march.free, 'ball');
      expect(c.distanceTo(freeBall), `free ball ${p}`).toBeLessThan(0.003);
      expect(c.y, `free ball height ${p}`).toBeLessThan(0.003);
    }

    // TWO: the pivot (right) ball is the world contact while the body turns.
    drive(fig, plan, 1 / 3);
    const pivotBall = bootContact(fig, march.pivot, 'ball');
    expect(pivotBall.y).toBeCloseTo(0, 2);
    for (const p of [0.36, 0.42, 0.5, 0.6, 2 / 3]) {
      drive(fig, plan, p);
      const c = bootContact(fig, march.pivot, 'ball');
      expect(c.distanceTo(pivotBall), `pivot ball ${p}`).toBeLessThan(0.003);
      expect(c.y, `pivot ball height ${p}`).toBeLessThan(0.003);
    }

    // THREE: the landed foot is flat and fixed while the pivot foot steps out.
    drive(fig, plan, 2 / 3);
    const landedBall = bootContact(fig, march.free, 'ball');
    const landedHeel = bootContact(fig, march.free, 'heel');
    expect(landedBall.y).toBeCloseTo(0, 2);
    expect(landedHeel.y).toBeCloseTo(0, 2);
    for (const p of [0.7, 0.78, 0.88, 0.96, 1]) {
      drive(fig, plan, p);
      expect(bootContact(fig, march.free, 'ball').distanceTo(landedBall), `landed ball ${p}`).toBeLessThan(0.003);
      expect(bootContact(fig, march.free, 'heel').distanceTo(landedHeel), `landed heel ${p}`).toBeLessThan(0.003);
    }
    fig.dispose();
  });

  it('mirrors the contact chain on a left turn', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = turnOf('leftTurnOnMarch');
    const march = plan.march!;
    drive(fig, plan, 0);
    const freeBall = bootContact(fig, march.free, 'ball');
    for (const p of [0.1, 0.2, 0.3, 1 / 3]) {
      drive(fig, plan, p);
      expect(bootContact(fig, march.free, 'ball').distanceTo(freeBall), `left free ball ${p}`).toBeLessThan(0.003);
    }
    drive(fig, plan, 1 / 3);
    const pivotBall = bootContact(fig, march.pivot, 'ball');
    for (const p of [0.4, 0.5, 0.6, 2 / 3]) {
      drive(fig, plan, p);
      expect(bootContact(fig, march.pivot, 'ball').distanceTo(pivotBall), `left pivot ball ${p}`).toBeLessThan(0.003);
    }
    drive(fig, plan, 2 / 3);
    const landedBall = bootContact(fig, march.free, 'ball');
    for (const p of [0.75, 0.9, 1]) {
      drive(fig, plan, p);
      expect(bootContact(fig, march.free, 'ball').distanceTo(landedBall), `left landed ball ${p}`).toBeLessThan(0.003);
    }
    fig.dispose();
  });

  it('ends on the new facing with the shot foot half a pace ahead', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = turnOf('rightTurnOnMarch');
    const march = plan.march!;
    const body = drive(fig, plan, 1);
    const pivotFoot = march.pivot === 'L' ? body.left : body.right;
    const freeFoot = march.free === 'L' ? body.left : body.right;
    expect(pivotFoot.planted && freeFoot.planted).toBe(true);
    expect(pivotFoot.z - freeFoot.z).toBeGreaterThan(0.3);
    const pivotBall = bootContact(fig, march.pivot, 'ball');
    const freeBall = bootContact(fig, march.free, 'ball');
    expect(pivotBall.y).toBeCloseTo(0, 2);
    expect(freeBall.y).toBeCloseTo(0, 2);
    const heading = fig.group.rotation.y;
    // The body now faces the new direction; the shot foot is ahead along that.
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    const ahead = (pivotBall.x - freeBall.x) * forward.x + (pivotBall.z - freeBall.z) * forward.z;
    expect(ahead).toBeGreaterThan(0.2);
    expect(Math.abs(heading)).toBeCloseTo(Math.PI / 2, 4);
    fig.dispose();
  });
});
