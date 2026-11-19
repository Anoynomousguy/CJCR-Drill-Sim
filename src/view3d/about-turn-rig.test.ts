import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, UNIFORMS } from '../engine/constants';
import { LEG } from '../engine/gait';
import { buildTimeline, sampleTimeline } from '../engine/simulate';
import { sampleStepPlan } from '../engine/steps';
import type { Plan } from '../engine/types';
import { createFigure, type Figure, type FigurePalette } from './figure';

const palette = UNIFORMS.army as unknown as FigurePalette;

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

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 4,
  squads: 2,
  ranks: 2,
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
  name: 'about rig',
  settings,
  roster: Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, height: 1.78 })),
  programme: [
    move('attention'),
    move('quickMarch', { paces: 6 }),
    move('aboutTurnOnMarch'),
    move('quickMarch', { paces: 3 }),
    move('halt'),
  ],
});

const seg = timeline.segments.find((s) => s.type === 'aboutTurnOnMarch')!;

/** Drive the live figure exactly as Stage3D does for the about turn. */
function drive(fig: Figure, p: number) {
  const t = seg.start + (seg.actionEnd - seg.start) * p;
  const sample = sampleTimeline(timeline, t);
  const s = sample.soldiers[0];
  const stepPlan = sample.steps?.[s.soldier.id];
  const step = stepPlan ? sampleStepPlan(stepPlan, sample.progress) : undefined;
  fig.setTransform(s.x, s.z, s.heading);
  fig.animate({
    from: sample.from,
    to: sample.to,
    u: sample.u,
    gait: s.gait,
    stride: s.stride,
    time: t,
    eyes: sample.to.eyes,
    headdress: sample.to.headdress,
    feet: step
      ? { left: step.left, right: step.right, hipY: step.hipY }
      : sample.turnBody
        ? { left: sample.turnBody.left, right: sample.turnBody.right, hipY: sample.turnBody.hipY }
        : undefined,
    turn: sample.turn,
  });
}

describe('about turn on the live rig', () => {
  it('holds the right ball for the first 90 and the left ball for the second', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    drive(fig, 0.4);
    const rightBall = bootContact(fig, 'R', 'ball');
    expect(rightBall.y).toBeCloseTo(0, 2);
    for (const p of [0.45, 0.5, 0.55, 0.6]) {
      drive(fig, p);
      const c = bootContact(fig, 'R', 'ball');
      expect(c.distanceTo(rightBall), `right ball ${p}`).toBeLessThan(0.003);
      expect(c.y, `right ball height ${p}`).toBeLessThan(0.003);
    }

    drive(fig, 0.6);
    const leftBall = bootContact(fig, 'L', 'ball');
    expect(leftBall.y).toBeCloseTo(0, 2);
    for (const p of [0.65, 0.7, 0.75, 0.8]) {
      drive(fig, p);
      const c = bootContact(fig, 'L', 'ball');
      expect(c.distanceTo(leftBall), `left ball ${p}`).toBeLessThan(0.003);
      expect(c.y, `left ball height ${p}`).toBeLessThan(0.003);
    }
    fig.dispose();
  });

  it('ends facing the new direction with the left boot half a pace ahead', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    drive(fig, 1);
    const leftBall = bootContact(fig, 'L', 'ball');
    const rightBall = bootContact(fig, 'R', 'ball');
    expect(leftBall.y).toBeCloseTo(0, 2);
    expect(rightBall.y).toBeCloseTo(0, 2);
    const heading = fig.group.rotation.y;
    expect(Math.abs(heading)).toBeCloseTo(Math.PI, 4);
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    const ahead = (leftBall.x - rightBall.x) * forward.x + (leftBall.z - rightBall.z) * forward.z;
    expect(ahead).toBeGreaterThan(0.25);
    expect(ahead).toBeLessThan(0.4);
    fig.dispose();
  });
});
