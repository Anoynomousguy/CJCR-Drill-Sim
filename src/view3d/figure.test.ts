import { describe, expect, it } from 'vitest';
import { UNIFORMS } from '../engine/constants';
import { LEG, gaitTargets } from '../engine/gait';
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

function read(fig: Figure, joint: string, side?: 'L' | 'R'): number {
  const entry = fig.getAngles().find((a) => a.joint === joint && a.side === side);
  if (!entry) throw new Error(`no ${joint} ${side ?? ''} reading`);
  return entry.value;
}

/** Animate several frames so the stand/walk blend settles. */
function pose(fig: Figure, snapshot: Snapshot, stride = 0, time = 0, frames = 30) {
  for (let i = 0; i < frames; i += 1) {
    fig.animate({
      from: snapshot,
      to: snapshot,
      u: 1,
      gait: snapshot.gait,
      stride,
      time: time + i / 60,
      eyes: snapshot.eyes,
      headdress: snapshot.headdress,
    });
  }
}

describe('live rig', () => {
  it('stands at attention with straight legs, feet on the ground and heels together', () => {
    const fig = rig();
    pose(fig, BASE);
    const p = fig.getPose();
    expect(p.hipY).toBeCloseTo(0.93, 2);
    expect(p.left.ankle[1]).toBeCloseTo(LEG.ankle, 3);
    expect(p.left.pitch).toBe(0);
    expect(p.left.yaw).toBe(15);
    expect(p.right.yaw).toBe(-15);
    expect(p.walking).toBe(0);
    for (const joint of ['hipFlexion', 'kneeFlexion', 'anklePlantar', 'toeExtension'] as const) {
      expect(read(fig, joint, 'L'), joint).toBeGreaterThanOrEqual(0);
      expect(read(fig, joint, 'L'), joint).toBeLessThanOrEqual(1);
      expect(read(fig, joint, 'R'), joint).toBeGreaterThanOrEqual(0);
      expect(read(fig, joint, 'R'), joint).toBeLessThanOrEqual(1);
    }
    fig.dispose();
  });

  it('marches with one foot planted and one in the air', () => {
    const fig = rig();
    const stride = 0.375; // quarter of a 1.5 m quick-time cycle
    pose(fig, { ...BASE, gait: 'quick' }, stride);
    const p = fig.getPose();
    const target = gaitTargets('quick', 0.25);
    expect(p.walking).toBe(1);
    expect(p.left.planted).toBe(true);
    expect(p.right.planted).toBe(false);
    // The pelvis lists over the stance hip, so it sits a few mm below the
    // flat-pelvis height the gait asks for.
    expect(Math.abs(p.hipY - target.hipY)).toBeLessThan(0.015);
    expect(p.left.ankle[2]).toBeCloseTo(target.left.z, 3);
    expect(p.left.pitch).toBeCloseTo(target.left.pitch, 3);
    expect(p.left.knee).toBeGreaterThan(3);
    expect(p.left.knee).toBeLessThan(140);
    expect(p.right.ankle[1]).toBeGreaterThan(LEG.ankle + 0.01);
    fig.dispose();
  });

  it('holds a planted foot in one world position through the whole stance', () => {
    const fig = rig();
    const world: number[] = [];
    for (let stride = 0.04; stride <= 0.84; stride += 0.04) {
      fig.setTransform(0, stride, 0);
      pose(fig, { ...BASE, gait: 'quick' }, stride, stride, 1);
      const p = fig.getPose();
      expect(p.left.planted, `stride ${stride}`).toBe(true);
      world.push(stride + p.left.ankle[2]);
    }
    expect(Math.max(...world) - Math.min(...world)).toBeLessThan(0.005);
    fig.dispose();
  });

  it('rolls the stance foot heel → flat → ball → toe', () => {
    const fig = rig();
    const at = (stride: number) => {
      pose(fig, { ...BASE, gait: 'quick' }, stride, stride, 1);
      return fig.getPose().left;
    };
    const strike = at(0.02);
    const flat = at(0.3);
    const heelOff = at(0.675);
    const toeOff = at(0.855);
    expect(strike.pitch).toBeLessThan(-5); // heel strike, toe up
    expect(flat.pitch).toBeGreaterThan(-1);
    expect(flat.pitch).toBeLessThan(1);
    expect(heelOff.pitch).toBeGreaterThan(10); // heel off, ball on the ground
    expect(heelOff.toe).toBeCloseTo(heelOff.pitch, 1); // toe stays flat at the MTP
    expect(heelOff.ankle[1]).toBeGreaterThan(LEG.ankle + 0.01);
    expect(toeOff.pitch).toBeGreaterThan(25);
    fig.dispose();
  });

  it('lifts the knee for mark time and keeps the stance foot down', () => {
    const fig = rig();
    pose(fig, { ...BASE, gait: 'markTime' }, 0, 0.125, 40);
    const p = fig.getPose();
    expect(p.left.planted || p.right.planted).toBe(true);
    expect(Math.max(p.left.knee, p.right.knee)).toBeGreaterThan(60);
    const lifted = p.left.planted ? p.right : p.left;
    expect(lifted.ankle[1]).toBeGreaterThan(0.15);
    fig.dispose();
  });

  it('matches gait positivity and symmetry in the live rig', () => {
    const fig = rig();
    const a = (() => {
      pose(fig, { ...BASE, gait: 'double' }, 0.5, 1, 40);
      return fig.getPose();
    })();
    const b = (() => {
      pose(fig, { ...BASE, gait: 'double' }, 1.5, 2, 1);
      return fig.getPose();
    })();
    expect(a.left.ankle[2]).toBeCloseTo(b.right.ankle[2], 2);
    expect(a.left.knee).toBeCloseTo(b.right.knee, 1);
    fig.dispose();
  });

  it('curls the fingers around a carried rifle and relaxes a free hand', () => {
    const fig = rig(true, false);
    pose(fig, { ...BASE, weapon: 'order' });
    expect(fig.getPose().fingers.right).toBeGreaterThan(0.8);
    expect(fig.getPose().fingers.left).toBeLessThan(0.4);

    pose(fig, { ...BASE, weapon: 'present' });
    expect(fig.getPose().fingers.left).toBeGreaterThan(0.8);
    expect(fig.getPose().fingers.right).toBeGreaterThan(0.8);

    pose(fig, BASE);
    expect(fig.getPose().fingers.left).toBeLessThan(0.4);
    expect(fig.getPose().fingers.right).toBeLessThan(0.4);
    fig.dispose();
  });

  it('holds every live joint inside its range in every carry and gait', () => {
    const fig = rig(true, true);
    const weapons: WeaponState[] = [
      'none', 'order', 'slope', 'present', 'port', 'inspection', 'trail', 'grounded', 'reversed', 'sling',
    ];
    const colours: ColourState[] = ['none', 'order', 'carry', 'slope', 'dip', 'letFly'];
    const gaits = ['halt', 'markTime', 'quick', 'double'] as const;
    let checked = 0;
    for (const weapon of weapons) {
      for (const colour of colours) {
        for (const gait of gaits) {
          pose(fig, { ...BASE, weapon, colour, gait }, gait === 'halt' ? 0 : 0.375, 0.125, 2);
          for (const entry of fig.getAngles()) {
            const where = `${weapon}/${colour}/${gait} ${entry.joint}`;
            expect(entry.value, where).toBeGreaterThanOrEqual(entry.min);
            expect(entry.value, where).toBeLessThanOrEqual(entry.max);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
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

describe('turning', () => {
  it('pivots with a head lead instead of spinning the whole body at once', () => {
    const fig = rig();
    fig.setTransform(0, 0, 0);
    pose(fig, BASE, 0, 0, 5);
    expect(Math.abs(fig.getPose().turn)).toBeLessThan(1);
    for (let i = 1; i <= 24; i += 1) {
      fig.setTransform(0, 0, (i / 24) * (Math.PI / 2));
      fig.animate({
        from: BASE,
        to: BASE,
        u: 1,
        gait: 'halt',
        stride: 0,
        time: 0.1 + i / 60,
        eyes: 'front',
        headdress: 'worn',
      });
    }
    expect(fig.getPose().turn).toBeGreaterThan(30);
    const turning = fig.getPose().turn;
    // Hold the new heading: the pivot settles instead of snapping back.
    for (let i = 0; i < 90; i += 1) {
      fig.animate({
        from: BASE,
        to: BASE,
        u: 1,
        gait: 'halt',
        stride: 0,
        time: 0.6 + i / 60,
        eyes: 'front',
        headdress: 'worn',
      });
    }
    expect(Math.abs(fig.getPose().turn)).toBeLessThan(turning * 0.1);
    fig.dispose();
  });
});
