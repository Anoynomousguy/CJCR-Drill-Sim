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

const programme = [
  move('attention'),
  move('quickMarch', { paces: 4 }),
  move('eyesRight'),
  move('quickMarch', { paces: 2 }),
  move('eyesFrontMarch'),
];

const timeline: Timeline = buildTimeline({
  version: 1,
  name: 'eyes on the march rig',
  settings,
  roster,
  programme,
});
const right = timeline.segments[2];
const front = timeline.segments[4];

const cmdTimeline: Timeline = buildTimeline({
  version: 1,
  name: 'eyes on the march commander rig',
  settings: { ...settings, commander: true },
  roster,
  programme,
});
const cmdRight = cmdTimeline.segments[2];
const cmdFront = cmdTimeline.segments[4];
const commander = cmdTimeline.soldiers.find((s) => s.role === 'commander')!;

function drive(fig: Figure, tl: Timeline, t: number, id: string) {
  const sample = sampleTimeline(tl, t);
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
    // Mirrors Stage3D: the head amount drives the turn itself.
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

describe('eyes right on the march on the live rig', () => {
  it('keeps marching and turns the head only over the second pace', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const id = timeline.soldiers[1].id;

    drive(fig, timeline, right.start + 1e-6, id);
    const startZ = fig.group.position.z;
    expect(Math.abs(headYaw(fig)), 'head still front at the command').toBeLessThan(5);

    for (let i = 0; i < 40; i += 1) drive(fig, timeline, right.start + 0.45, id);
    expect(Math.abs(headYaw(fig)), 'head still front through the first pace').toBeLessThan(5);

    for (let i = 0; i < 40; i += 1) drive(fig, timeline, right.actionEnd - 1e-6, id);
    expect(Math.abs(headYaw(fig)), 'head turned right on the left footfall').toBeGreaterThan(25);
    // The squad had not frozen: the figure has marched the two paces.
    expect(fig.group.position.z - startZ, 'two paces of ground').toBeGreaterThan(1.2);
    fig.dispose();
  });
});

describe('eyes front on the march on the live rig', () => {
  it('cuts the head to the front as the left foot lands', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const id = timeline.soldiers[1].id;

    for (let i = 0; i < 40; i += 1) drive(fig, timeline, front.start + 1e-6, id);
    expect(Math.abs(headYaw(fig)), 'head right before the cut').toBeGreaterThan(25);

    for (let i = 0; i < 40; i += 1) drive(fig, timeline, front.actionEnd - 1e-6, id);
    expect(Math.abs(headYaw(fig)), 'head front on the left footfall').toBeLessThan(5);
    fig.dispose();
  });

  it("checks the commander's arms on the right foot and holds them there", () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);

    drive(fig, cmdTimeline, cmdRight.actionEnd - 1e-6, commander.id);
    const chest = fig.group.getObjectByName('chest')!;
    const brow = chest.localToWorld(new THREE.Vector3(...POSTURE_HANDS.salute.right));
    expect(bone(fig, 'hand.R').distanceTo(brow), 'salute up on the eyes right').toBeLessThan(0.03);

    // Half-way through EYES FRONT is the right foot: the salute is already
    // checked to the side there, while the head cuts on the following left.
    drive(fig, cmdTimeline, cmdFront.start + 0.5 + 1e-6, commander.id);
    expect(bone(fig, 'hand.R').y, 'arms checked on the right foot').toBeLessThan(1.2);
    drive(fig, cmdTimeline, cmdFront.actionEnd - 1e-6, commander.id);
    expect(bone(fig, 'hand.R').y, 'arms at the side at the end').toBeLessThan(1.2);
    fig.dispose();
  });
});
