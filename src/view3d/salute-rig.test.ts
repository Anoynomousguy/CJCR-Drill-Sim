import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BEAT, DEFAULT_SETTINGS, UNIFORMS } from '../engine/constants';
import { POSTURE_HANDS } from '../engine/pose';
import { buildTimeline, sampleTimeline, type Segment, type Timeline } from '../engine/simulate';
import type { Plan } from '../engine/types';
import { createFigure, type Figure, type FigurePalette } from './figure';

const palette = UNIFORMS.army as unknown as FigurePalette;

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 4,
  squads: 1,
  ranks: 2,
  colours: 0,
  commander: false,
  supernumerary: false,
  armed: false,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 4 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));

const timeline: Timeline = buildTimeline({
  version: 1,
  name: 'salute rig',
  settings,
  roster,
  programme: [
    { id: 'attention', type: 'attention', params: {} },
    { id: 'salute', type: 'salute', params: {} },
  ],
});
const salute = timeline.segments[1];

function drive(fig: Figure, t: number, seg: Segment) {
  const sample = sampleTimeline(timeline, t);
  const id = timeline.soldiers[0].id;
  const soldier = sample.soldiers.find((s) => s.soldier.id === id)!;
  fig.setHeight(soldier.soldier.height);
  fig.setTransform(soldier.x, soldier.z, soldier.heading);
  fig.animate({
    from: sample.from,
    to: sample.to,
    u: sample.u,
    gait: soldier.gait,
    stride: soldier.stride,
    time: sample.t,
    eyes: sample.to.eyes,
    headdress: sample.to.headdress,
    code: soldier.code,
    saluteArm: sample.saluteArm,
  });
  fig.group.updateMatrixWorld(true);
  return sample;
}

function bone(fig: Figure, name: string): THREE.Vector3 {
  const b = fig.group.getObjectByName(name);
  if (!b) throw new Error(`no ${name}`);
  return b.getWorldPosition(new THREE.Vector3());
}

function chestWorld(fig: Figure, p: [number, number, number]): THREE.Vector3 {
  const chest = fig.group.getObjectByName('chest');
  if (!chest) throw new Error('no chest');
  return chest.localToWorld(new THREE.Vector3(p[0], p[1], p[2]));
}

describe('salute on the live rig', () => {
  it('holds the upper arm level, the hand on the headdress, and cuts away', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    // One beat up, then the middle of the standard pause: the hold.
    const held = drive(fig, salute.start + BEAT + 0.5, salute);
    expect(held.saluteArm).toBe(1);

    const shoulder = bone(fig, 'upperArm.R');
    const elbow = bone(fig, 'foreArm.R');
    expect(Math.abs(elbow.y - shoulder.y), 'upper arm parallel to the ground').toBeLessThan(0.006);

    const hand = bone(fig, 'hand.R');
    const target = chestWorld(fig, POSTURE_HANDS.salute.right);
    expect(hand.distanceTo(target), 'wrist at the salute target').toBeLessThan(0.025);

    const tip = fig.group
      .getObjectByName('hand.R')!
      .localToWorld(new THREE.Vector3(0, -0.16, 0));
    const brow = fig.group
      .getObjectByName('head')!
      .localToWorld(new THREE.Vector3(-0.05, 0.182, 0.081));
    expect(tip.distanceTo(brow), 'second fingertip on the headdress').toBeLessThan(0.03);

    // TWO: the hand is back at the side by the end of the action.
    drive(fig, salute.actionEnd, salute);
    expect(bone(fig, 'hand.R').y).toBeLessThan(1.2);
    fig.dispose();
  });
});
