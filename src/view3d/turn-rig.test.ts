import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UNIFORMS } from '../engine/constants';
import { LEG } from '../engine/gait';
import { makeTurnPlan, turnBodyAt, turnHeadingAt, type TurnPlan } from '../engine/turn';
import type { Snapshot } from '../engine/types';
import { createFigure, type Figure, type FigurePalette } from './figure';

const palette = UNIFORMS.army as unknown as FigurePalette;

const BASE: Snapshot = {
  posture: 'attention',
  weapon: 'none',
  colour: 'none',
  gait: 'halt',
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

/** Drive the live figure exactly as Stage3D does for a halt turn. */
function drive(fig: Figure, plan: TurnPlan, progress: number) {
  const body = turnBodyAt(plan, progress);
  if (!body) throw new Error('no turn body');
  const heading = plan.angle * turnHeadingAt(plan, progress);
  fig.setTransform(body.x, body.z, heading);
  fig.animate({
    from: BASE,
    to: BASE,
    u: 1,
    gait: 'halt',
    stride: 0,
    time: progress,
    eyes: 'front',
    headdress: 'worn',
    feet: { left: body.left, right: body.right, hipY: body.hipY },
    turn: { plan, progress },
  });
  return body;
}


describe('halt turn on the live rig', () => {
  it('does not move the boot contacts through a right pivot', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makeTurnPlan('halt', 90, 'right');
    drive(fig, plan, 0);
    const heel = bootContact(fig, 'R', 'heel');
    const ball = bootContact(fig, 'L', 'ball');
    expect(heel.y).toBeCloseTo(0, 2);
    expect(ball.y).toBeCloseTo(0, 2);

    for (const p of [0.05, 0.15, 0.28, 0.4, 0.54]) {
      drive(fig, plan, p);
      const h = bootContact(fig, 'R', 'heel');
      const b = bootContact(fig, 'L', 'ball');
      expect(h.distanceTo(heel), `right heel ${p}`).toBeLessThan(0.003);
      expect(h.y, `right heel height ${p}`).toBeLessThan(0.003);
      expect(b.distanceTo(ball), `left ball ${p}`).toBeLessThan(0.003);
      expect(b.y, `left ball height ${p}`).toBeLessThan(0.003);
    }
    fig.dispose();
  });

  it('does not move the mirrored contacts through a left pivot', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makeTurnPlan('halt', 90, 'left');
    drive(fig, plan, 0);
    const heel = bootContact(fig, 'L', 'heel');
    const ball = bootContact(fig, 'R', 'ball');
    for (const p of [0.05, 0.15, 0.28, 0.4, 0.54]) {
      drive(fig, plan, p);
      expect(bootContact(fig, 'L', 'heel').distanceTo(heel), `left heel ${p}`).toBeLessThan(0.003);
      expect(bootContact(fig, 'R', 'ball').distanceTo(ball), `right ball ${p}`).toBeLessThan(0.003);
    }
    fig.dispose();
  });

  it('keeps the right heel fixed through a 180 about turn and closes the left foot', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makeTurnPlan('halt', 180, 'right');
    drive(fig, plan, 0);
    const heel = bootContact(fig, 'R', 'heel');
    const ball = bootContact(fig, 'L', 'ball');
    for (const p of [0.1, 0.25, 0.4, 0.54]) {
      drive(fig, plan, p);
      expect(bootContact(fig, 'R', 'heel').distanceTo(heel), `about heel ${p}`).toBeLessThan(0.003);
      expect(bootContact(fig, 'L', 'ball').distanceTo(ball), `about ball ${p}`).toBeLessThan(0.003);
    }

    // The close is a real lift, and the right heel stays put throughout it.
    drive(fig, plan, 0.85);
    expect(bootContact(fig, 'R', 'heel').distanceTo(heel), 'about close heel').toBeLessThan(0.003);
    const end = drive(fig, plan, 1);
    expect(end.left.x).toBeCloseTo(LEG.standX, 5);
    expect(end.right.x).toBeCloseTo(-LEG.standX, 5);
    expect(end.left.z).toBeCloseTo(0, 5);
    expect(end.right.z).toBeCloseTo(0, 5);
    expect(bootContact(fig, 'R', 'heel').distanceTo(heel), 'about done heel').toBeLessThan(0.003);
    fig.dispose();
  });
});
