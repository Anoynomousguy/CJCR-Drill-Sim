import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, UNIFORMS } from '../engine/constants';
import { carriageDir } from '../engine/pose';
import { buildTimeline, sampleTimeline, type Segment, type Timeline } from '../engine/simulate';
import { sampleStepPlan } from '../engine/steps';
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
  armed: true,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 6 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));

function timelineOf(programme: Plan['programme']): Timeline {
  return buildTimeline({
    version: 1,
    name: 'rifle rig',
    settings,
    roster,
    programme,
  });
}

const move = (type: string, params: Record<string, number | string> = {}) => ({
  id: type,
  type,
  params,
});

function drive(fig: Figure, timeline: Timeline, t: number, seg: Segment) {
  const sample = sampleTimeline(timeline, t);
  const id = timeline.soldiers[0].id;
  const soldier = sample.soldiers.find((s) => s.soldier.id === id)!;
  const plan = seg.steps?.[id];
  const step = plan ? sampleStepPlan(plan, sample.progress) : undefined;
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
    rifle: sample.rifle,
    feet: step ? { left: step.left, right: step.right, hipY: step.hipY } : undefined,
  });
  fig.group.updateMatrixWorld(true);
  return { sample, step, id };
}

function expectedWrist(fig: Figure, hand: [number, number, number], grip: number, side: 1 | -1, dir: [number, number, number]) {
  const bar = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const target = new THREE.Vector3(hand[0], hand[1], hand[2]);
  if (grip <= 0.5) return target;
  const out = new THREE.Vector3(side, 0, 0);
  out.addScaledVector(bar, -out.dot(bar));
  if (out.lengthSq() < 1e-5) out.set(0, 0, 1).addScaledVector(bar, -bar.z);
  out.normalize().multiplyScalar(0.03);
  return target.clone().add(out);
}

function handWorld(fig: Figure, side: 'L' | 'R'): THREE.Vector3 {
  const bone = fig.group.getObjectByName(`hand.${side}`);
  if (!bone) throw new Error(`no hand.${side}`);
  return bone.getWorldPosition(new THREE.Vector3());
}

function chestWorld(fig: Figure, p: THREE.Vector3): THREE.Vector3 {
  const chest = fig.group.getObjectByName('chest');
  if (!chest) throw new Error('no chest');
  return chest.localToWorld(p.clone());
}

describe('rifle counts on the live rig', () => {
  it('puts both hands on the rifle on every gripping count', () => {
    const timeline = timelineOf([move('attention'), move('slopeArms'), move('orderArms')]);
    const fig = createFigure({ palette, detail: 'low' }, true, false);
    for (const type of ['slopeArms', 'orderArms']) {
      const seg = timeline.segments.find((s) => s.type === type)!;
      for (const step of seg.rifle!.steps) {
        const { sample } = drive(fig, timeline, seg.start + step.end, seg);
        expect(sample.rifle, type).toBeDefined();
        const rifle = sample.rifle!;
        const l = expectedWrist(fig, rifle.handL, rifle.gripL, 1, carriageDir(rifle.carriage));
        const r = expectedWrist(fig, rifle.handR, rifle.gripR, -1, carriageDir(rifle.carriage));
        expect(handWorld(fig, 'L').distanceTo(chestWorld(fig, l)), `${type} L ${step.count}`).toBeLessThan(0.02);
        expect(handWorld(fig, 'R').distanceTo(chestWorld(fig, r)), `${type} R ${step.count}`).toBeLessThan(0.02);
      }
    }
    fig.dispose();
  });

  it('places the live rifle frame on the manual count frame', () => {
    const timeline = timelineOf([
      move('attention'),
      move('slopeArms'),
      move('presentArms'),
      move('slopeFromPresent'),
      move('orderArms'),
    ]);
    const fig = createFigure({ palette, detail: 'low' }, true, false);
    for (const type of ['slopeArms', 'orderArms', 'presentArms']) {
      const seg = timeline.segments.find((s) => s.type === type)!;
      for (const step of seg.rifle!.steps) {
        const { sample } = drive(fig, timeline, seg.start + step.end, seg);
        const live = fig.getCarriage().weapon!;
        const want = sample.rifle!.carriage;
        expect(Math.hypot(live.butt[0] - want.butt[0], live.butt[1] - want.butt[1], live.butt[2] - want.butt[2])).toBeLessThan(0.01);
        expect(Math.hypot(live.dir[0] - carriageDir(want)[0], live.dir[1] - carriageDir(want)[1], live.dir[2] - carriageDir(want)[2])).toBeLessThan(0.01);
      }
    }
    fig.dispose();
  });

  it('plants the right foot behind the left on PRESENT THREE and closes it on SLOPE TWO', () => {
    const timeline = timelineOf([
      move('attention'),
      move('slopeArms'),
      move('presentArms'),
      move('slopeFromPresent'),
    ]);
    const fig = createFigure({ palette, detail: 'low' }, true, false);
    const present = timeline.segments.find((s) => s.type === 'presentArms')!;
    const slope = timeline.segments.find((s) => s.type === 'slopeFromPresent')!;

    const atPresent = drive(fig, timeline, present.actionEnd - 0.001, present);
    expect(atPresent.step).toBeDefined();
    const want = atPresent.step!.right;
    expect(want.z).toBeLessThan(-0.1);
    const rightBone = fig.group.getObjectByName('foot.R')!;
    const actual = rightBone.getWorldPosition(new THREE.Vector3());
    const expected = fig.group.localToWorld(new THREE.Vector3(want.x, want.y, want.z));
    expect(actual.distanceTo(expected)).toBeLessThan(0.01);

    const atSlope = drive(fig, timeline, slope.actionEnd, slope);
    expect(atSlope.step!.right.z).toBeCloseTo(0, 5);
    expect(atSlope.step!.right.x).toBeCloseTo(-0.04, 5);
    expect(atSlope.step!.right.yaw).toBeCloseTo(-15, 5);
    fig.dispose();
  });

  it('leaves the free hand at the side on SLOPE THREE', () => {
    const timeline = timelineOf([move('attention'), move('slopeArms')]);
    const seg = timeline.segments.find((s) => s.type === 'slopeArms')!;
    const fig = createFigure({ palette, detail: 'low' }, true, false);
    const { sample } = drive(fig, timeline, seg.start + seg.rifle!.steps[2].end, seg);
    expect(sample.rifle!.gripR).toBe(0);
    expect(handWorld(fig, 'R').y).toBeLessThan(1.02);
    expect(sample.rifle!.gripL).toBe(1);
    fig.dispose();
  });
});
