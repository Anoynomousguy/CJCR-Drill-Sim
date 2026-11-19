import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BEAT, DEFAULT_SETTINGS, UNIFORMS } from '../engine/constants';
import { RIFLE, RIFLE_CARRIAGE, carriageDir } from '../engine/pose';
import { buildTimeline, sampleTimeline, type Timeline } from '../engine/simulate';
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
  armed: true,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 4 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));

const timeline: Timeline = buildTimeline({
  version: 1,
  name: 'salute at the slope rig',
  settings,
  roster,
  programme: [
    { id: 'attention', type: 'attention', params: {} },
    { id: 'slopeArms', type: 'slopeArms', params: {} },
    { id: 'saluteAtSlope', type: 'saluteAtSlope', params: {} },
  ],
});
const salute = timeline.segments[2];

function drive(fig: Figure, t: number) {
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
    rifle: sample.rifle,
  });
  fig.group.updateMatrixWorld(true);
  return sample;
}

function bone(fig: Figure, name: string): THREE.Vector3 {
  const b = fig.group.getObjectByName(name);
  if (!b) throw new Error(`no ${name}`);
  return b.getWorldPosition(new THREE.Vector3());
}

describe('salute at the slope on the live rig', () => {
  it('strikes the small of the butt with a level forearm and the rifle still on the shoulder', () => {
    const fig = createFigure({ palette, detail: 'low' }, true, false);
    const held = drive(fig, salute.start + BEAT + 0.5);
    expect(held.saluteArm).toBe(1);

    // The hand crosses the body in front of the tunic, not through it.
    drive(fig, salute.start + BEAT / 2);
    const chest = fig.group.getObjectByName('chest');
    if (!chest) throw new Error('no chest');
    const crossing = chest.worldToLocal(bone(fig, 'hand.R').clone());
    expect(crossing.z, 'right hand crosses in front of the tunic').toBeGreaterThan(0.11);

    // Back to the middle of the standard pause: the hold.
    drive(fig, salute.start + BEAT + 0.5);
    const weapon = fig.group.getObjectByName('weapon');
    if (!weapon) throw new Error('no weapon');
    const small = weapon.localToWorld(new THREE.Vector3(0, RIFLE.grip.small, 0));
    const buttPlate = weapon.localToWorld(new THREE.Vector3(0, 0.02, 0));
    const wrist = bone(fig, 'hand.R');
    const leftWrist = bone(fig, 'hand.L');

    expect(wrist.distanceTo(small), 'right wrist at the small of the butt').toBeLessThan(0.03);
    // A gripping wrist stands one palm's thickness out from the rifle axis, so
    // the left hand closes round the butt plate instead of sitting on it.
    expect(leftWrist.distanceTo(buttPlate), 'left hand keeps the butt plate').toBeCloseTo(0.03, 2);

    // 54-04 para 90: forearm horizontal, back of the hand uppermost, fingers
    // and thumb together and straight.
    const elbow = bone(fig, 'foreArm.R');
    expect(Math.abs(elbow.y - wrist.y), 'right forearm horizontal').toBeLessThan(0.008);
    expect(fig.getPose().fingers.right, 'fingers straight').toBeLessThan(0.05);

    // The old implementation saluted the headdress while carrying the rifle.
    const brow = fig.group
      .getObjectByName('head')!
      .localToWorld(new THREE.Vector3(-0.05, 0.182, 0.081));
    expect(wrist.distanceTo(brow), 'not the salute without arms').toBeGreaterThan(0.3);

    // The rifle is still the slope frame, and the left forearm holding it is
    // parallel to the ground (54-04 para 27).
    const frame = fig.getCarriage().weapon!;
    const dir = carriageDir(frame);
    const want = carriageDir(RIFLE_CARRIAGE.slope);
    expect(frame.butt[0]).toBeCloseTo(RIFLE_CARRIAGE.slope.butt[0], 6);
    expect(frame.butt[1]).toBeCloseTo(RIFLE_CARRIAGE.slope.butt[1], 6);
    expect(frame.butt[2]).toBeCloseTo(RIFLE_CARRIAGE.slope.butt[2], 6);
    expect(dir[1]).toBeCloseTo(want[1], 6);
    expect(dir[2]).toBeCloseTo(want[2], 6);
    const leftElbow = bone(fig, 'foreArm.L');
    expect(
      Math.abs(leftElbow.y - leftWrist.y),
      'left forearm parallel to the ground at the slope',
    ).toBeLessThan(0.003);
    // The other level intersection is inside the ribcage; the elbow that is
    // taken hangs by the side, outboard of the shoulder and behind the hand.
    const leftShoulder = bone(fig, 'upperArm.L');
    expect(leftElbow.x, 'left elbow clear of the ribs').toBeGreaterThan(leftShoulder.x);
    expect(leftElbow.z, 'left forearm points forward').toBeLessThan(leftWrist.z);

    // TWO: the hand is back at the side by the end of the action, the rifle
    // still held by the left hand.
    drive(fig, salute.actionEnd);
    expect(bone(fig, 'hand.R').y).toBeLessThan(1.2);
    const leftAfter = bone(fig, 'hand.L');
    const buttAfter = weapon.localToWorld(new THREE.Vector3(0, 0.02, 0));
    expect(leftAfter.distanceTo(buttAfter), 'left hand keeps the butt after the cut').toBeCloseTo(
      0.03,
      2,
    );
    fig.dispose();
  });
});
