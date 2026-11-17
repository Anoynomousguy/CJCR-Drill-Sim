import { describe, expect, it } from 'vitest';
import { GAIT_ANATOMY, type JointName } from '../engine/anatomy';
import { UNIFORMS } from '../engine/constants';
import { BODY, RIFLE_CARRIAGE } from '../engine/pose';
import type { ColourState, Snapshot, WeaponState } from '../engine/types';
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

const rig = (armed = false, colour = false): Figure =>
  createFigure({ palette, detail: 'low' }, armed, colour);

function read(fig: Figure, joint: JointName, side?: 'L' | 'R'): number {
  const entry = fig.getAngles().find((a) => a.joint === joint && a.side === side);
  if (!entry) throw new Error(`no ${joint} ${side ?? ''} reading`);
  return entry.value;
}

function pose(fig: Figure, snapshot: Snapshot, stride = 0, time = 0) {
  fig.animate({
    from: snapshot,
    to: snapshot,
    u: 1,
    gait: snapshot.gait,
    stride,
    time,
    eyes: snapshot.eyes,
    headdress: snapshot.headdress,
  });
}

describe('live rig', () => {
  it('reports the manual hip, knee and ankle for every gait', () => {
    for (const gait of ['quick', 'slow', 'double'] as const) {
      const fig = rig();
      // A quarter of a 1.5 m stride is the top of the left leg's swing.
      pose(fig, { ...BASE, gait }, 0.375);
      const target = GAIT_ANATOMY[gait];
      expect(read(fig, 'hipFlexion', 'L'), gait).toBe(Math.round(target.hip));
      expect(read(fig, 'kneeFlexion', 'L'), gait).toBe(Math.round(target.knee));
      expect(read(fig, 'anklePlantar', 'L'), gait).toBe(Math.round(target.ankle));
      expect(read(fig, 'hipFlexion', 'R'), gait).toBe(Math.round(-target.hipBack));
      expect(read(fig, 'kneeFlexion', 'R'), gait).toBe(Math.round(target.kneeBack));
      fig.dispose();
    }
  });

  it('swings a free arm to the gait angle and bends the elbow to match', () => {
    for (const gait of ['quick', 'slow', 'double'] as const) {
      const fig = rig();
      pose(fig, { ...BASE, gait }, 0.375);
      const target = GAIT_ANATOMY[gait];
      expect(read(fig, 'elbowFlexion', 'L'), gait).toBe(Math.round(target.elbow));
      expect(read(fig, 'elbowFlexion', 'R'), gait).toBe(Math.round(target.elbow));
      // The humerus carries the swing: right forward, left back at this phase.
      const right = read(fig, 'shoulderFlexion', 'R');
      const left = read(fig, 'shoulderFlexion', 'L');
      expect(right, gait).toBeGreaterThan(left);
      expect(right - left, gait).toBeGreaterThan(target.shoulderSwing * 0.7);
      fig.dispose();
    }
  });

  it('lifts mark time to 90/90 and holds the halt at zero', () => {
    const marking = rig();
    pose(marking, { ...BASE, gait: 'markTime' }, 0, 0.125);
    expect(read(marking, 'hipFlexion', 'L')).toBe(90);
    expect(read(marking, 'kneeFlexion', 'L')).toBe(90);
    expect(read(marking, 'anklePlantar', 'L')).toBe(12);
    marking.dispose();

    const halt = rig();
    pose(halt, { ...BASE, gait: 'halt' });
    for (const joint of ['hipFlexion', 'kneeFlexion', 'anklePlantar'] as const) {
      expect(read(halt, joint, 'L')).toBe(0);
      expect(read(halt, joint, 'R')).toBe(0);
    }
    halt.dispose();
  });

  it('holds every live joint inside its range in every carry and gait', () => {
    const fig = rig(true, true);
    const weapons: WeaponState[] = [
      'none',
      'order',
      'slope',
      'present',
      'port',
      'inspection',
      'trail',
      'grounded',
      'reversed',
      'sling',
    ];
    const colours: ColourState[] = ['none', 'order', 'carry', 'slope', 'dip', 'letFly'];
    const gaits = ['halt', 'markTime', 'quick', 'double'] as const;
    let checked = 0;
    for (const weapon of weapons) {
      for (const colour of colours) {
        for (const gait of gaits) {
          pose(fig, { ...BASE, weapon, colour, gait }, gait === 'halt' ? 0 : 0.375, 0.125);
          for (const entry of fig.getAngles()) {
            const where = `${weapon}/${colour}/${gait} ${entry.joint}`;
            expect(entry.value, where).toBeGreaterThanOrEqual(entry.min);
            expect(entry.value, where).toBeLessThanOrEqual(entry.max);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    fig.dispose();
  });

  it('places the live rifle on the left shoulder at the slope', () => {
    const fig = rig(true, false);
    pose(fig, { ...BASE, weapon: 'slope' });
    const live = fig.getCarriage().weapon;
    expect(live).not.toBeNull();
    const { butt, dir } = live!;
    const toShoulder = [BODY.shoulderX - butt[0], BODY.shoulderY - butt[1], -butt[2]];
    const along = toShoulder[0] * dir[0] + toShoulder[1] * dir[1] + toShoulder[2] * dir[2];
    const closest = [butt[0] + dir[0] * along, butt[1] + dir[1] * along, butt[2] + dir[2] * along];
    const gap = Math.hypot(closest[0] - BODY.shoulderX, closest[1] - BODY.shoulderY, closest[2]);
    expect(along).toBeGreaterThan(0.3);
    expect(gap).toBeLessThan(0.06);
    fig.dispose();
  });

  it('applies the same rifle frame the pose model specifies', () => {
    const fig = rig(true, false);
    for (const state of ['order', 'present', 'port'] as const) {
      pose(fig, { ...BASE, weapon: state });
      const live = fig.getCarriage().weapon;
      expect(live, state).not.toBeNull();
      const model = RIFLE_CARRIAGE[state];
      expect(live!.butt[0], state).toBeCloseTo(model.butt[0], 5);
      expect(live!.butt[1], state).toBeCloseTo(model.butt[1], 5);
      expect(live!.butt[2], state).toBeCloseTo(model.butt[2], 5);
      expect(live!.dir[1], state).toBeGreaterThan(0.8);
    }
    fig.dispose();
  });
});
