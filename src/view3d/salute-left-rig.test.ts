import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, UNIFORMS } from '../engine/constants';
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

const timeline: Timeline = buildTimeline({
  version: 1,
  name: 'salute to the left rig',
  settings,
  roster,
  programme: [move('attention'), move('quickMarch', { paces: 4 }), move('saluteOnMarchLeft')],
});
const salute = timeline.segments[2];
const id = timeline.soldiers[1].id;

function drive(fig: Figure, t: number) {
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
    eyes:
      sample.eyesAmount !== undefined
        ? sample.eyesAmount > 0.001
          ? (sample.eyesDir ?? 'right')
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

describe('salute on the march to the left on the live rig', () => {
  it('puts the hand on the headdress with the head turned left, then front', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);

    for (let i = 0; i < 40; i += 1) drive(fig, salute.start + 0.5);
    expect(Math.abs(headYaw(fig)), 'head front on CHECK').toBeLessThan(5);
    expect(bone(fig, 'hand.R').y, 'arm down on CHECK').toBeLessThan(1.2);

    for (let i = 0; i < 40; i += 1) drive(fig, salute.start + 1.0);
    const chest = fig.group.getObjectByName('chest')!;
    const brow = chest.localToWorld(new THREE.Vector3(...POSTURE_HANDS.salute.right));
    expect(bone(fig, 'hand.R').distanceTo(brow), 'hand at the headdress on UP').toBeLessThan(0.03);
    expect(headYaw(fig), 'head turned left on UP').toBeGreaterThan(25);

    for (let i = 0; i < 40; i += 1) drive(fig, salute.start + 1.5);
    expect(headYaw(fig), 'head still left through the hold').toBeGreaterThan(25);

    for (let i = 0; i < 40; i += 1) drive(fig, salute.start + 3.999);
    expect(Math.abs(headYaw(fig)), 'head front on SWING').toBeLessThan(5);
    expect(bone(fig, 'hand.R').y, 'arm down on SWING').toBeLessThan(1.2);
    fig.dispose();
  });
});
