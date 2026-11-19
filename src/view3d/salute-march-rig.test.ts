import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BEAT, DEFAULT_SETTINGS, UNIFORMS } from '../engine/constants';
import { POSTURE_HANDS } from '../engine/pose';
import { buildTimeline, sampleTimeline, type Timeline } from '../engine/simulate';
import type { Plan } from '../engine/types';
import { createFigure, type Figure, type FigurePalette } from './figure';

const palette = UNIFORMS.army as unknown as FigurePalette;

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 6,
  squads: 1,
  ranks: 2,
  colours: 0,
  commander: false,
  supernumerary: false,
  armed: false,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 6 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));
const move = (type: string, params: Record<string, number | string> = {}) => ({ id: type, type, params });

const saluteTimeline: Timeline = buildTimeline({
  version: 1,
  name: 'salute on the march rig',
  settings,
  roster,
  programme: [move('attention'), move('quickMarch', { paces: 4 }), move('saluteOnMarch')],
});
const salute = saluteTimeline.segments[2];

const eyesTimeline: Timeline = buildTimeline({
  version: 1,
  name: 'commander eyes rig',
  settings: { ...settings, commander: true },
  roster,
  programme: [
    move('attention'),
    move('quickMarch', { paces: 4 }),
    move('eyesRight'),
    move('eyesFrontMarch'),
  ],
});
const eyesRight = eyesTimeline.segments[2];
const eyesFront = eyesTimeline.segments[3];
const commander = eyesTimeline.soldiers.find((s) => s.role === 'commander')!;

function drive(fig: Figure, timeline: Timeline, t: number, id: string) {
  const sample = sampleTimeline(timeline, t);
  const soldier = sample.soldiers.find((s) => s.soldier.id === id)!;
  fig.setHeight(soldier.soldier.height);
  fig.setTransform(soldier.x, soldier.z, soldier.heading);
  fig.animate({
    from: sample.from,
    to: sample.to,
    u: sample.u,
    gait: soldier.gait,
    stride: soldier.stride,
    role: soldier.soldier.role,
    code: soldier.code,
    time: sample.t,
    // Mirrors Stage3D: the march salute's head weight drives the turn itself.
    eyes: sample.eyesAmount !== undefined
      ? sample.eyesAmount > 0.001
        ? 'right'
        : 'front'
      : sample.u > 0.45
        ? sample.to.eyes
        : sample.from.eyes,
    headdress: sample.to.headdress,
    eyesAmount: sample.eyesAmount ?? 1,
    saluteArm: sample.saluteArm,
    commanderSalute: sample.commanderSalute,
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

function headYaw(fig: Figure): number {
  const head = fig.group.getObjectByName('head');
  if (!head) throw new Error('no head');
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    head.getWorldQuaternion(new THREE.Quaternion()),
  );
  return (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
}

function brow(fig: Figure): THREE.Vector3 {
  const chest = fig.group.getObjectByName('chest');
  if (!chest) throw new Error('no chest');
  return chest.localToWorld(new THREE.Vector3(...POSTURE_HANDS.salute.right));
}

describe('salute on the march on the live rig', () => {
  it('holds the hand at the headdress from UP to FIVE and brings it down on DOWN', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    // Not the directing flank: the marker keeps head and eyes front by design.
    const id = saluteTimeline.soldiers[1].id;

    // CHECK: the arm is still swinging down at the side and the head is front.
    drive(fig, saluteTimeline, salute.start + 0.5, id);
    expect(bone(fig, 'hand.R').y, 'arm down on CHECK').toBeLessThan(1.2);
    expect(Math.abs(headYaw(fig)), 'head front on CHECK').toBeLessThan(5);

    // UP: the hand is on the headdress and the head turns into the salute.
    for (let i = 0; i < 40; i += 1) drive(fig, saluteTimeline, salute.start + 1.0, id);
    expect(Math.abs(headYaw(fig)), 'head turned right on UP').toBeGreaterThan(25);
    expect(bone(fig, 'hand.R').distanceTo(brow(fig)), 'hand at the headdress on UP').toBeLessThan(
      0.03,
    );

    // TWO through FIVE: still held.
    for (const t of [1.5, 2.0, 2.5, 3.0]) {
      drive(fig, saluteTimeline, salute.start + t, id);
      expect(
        bone(fig, 'hand.R').distanceTo(brow(fig)),
        `held at ${t} s`,
      ).toBeLessThan(0.03);
    }

    // DOWN: cut to the side.
    drive(fig, saluteTimeline, salute.start + 3.5, id);
    expect(bone(fig, 'hand.R').y, 'arm cut on DOWN').toBeLessThan(1.2);

    // SWING: the head is back to the front with the arms.
    for (let i = 0; i < 40; i += 1) drive(fig, saluteTimeline, salute.start + 3.999, id);
    expect(Math.abs(headYaw(fig)), 'head front on SWING').toBeLessThan(5);
    fig.dispose();
  });
});

describe("the commander's salute through eyes right and eyes front on the rig", () => {
  it('raises on EYES RIGHT and checks the arm to the side by the end of EYES FRONT', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);

    drive(fig, eyesTimeline, eyesRight.start + 1e-6, commander.id);
    expect(bone(fig, 'hand.R').y, 'arm down before the eyes right').toBeLessThan(1.2);

    drive(fig, eyesTimeline, eyesRight.actionEnd, commander.id);
    expect(bone(fig, 'hand.R').distanceTo(brow(fig)), 'salutes on the eyes right').toBeLessThan(
      0.03,
    );

    drive(fig, eyesTimeline, eyesFront.actionEnd, commander.id);
    expect(bone(fig, 'hand.R').y, 'arm checked to the side on eyes front').toBeLessThan(1.2);
    fig.dispose();
  });
});
