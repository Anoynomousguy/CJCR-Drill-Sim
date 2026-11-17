import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UNIFORMS } from '../engine/constants';
import { LEG, gaitTargets } from '../engine/gait';
import { BODY, RIFLE_CARRIAGE } from '../engine/pose';
import { makeTurnPlan, turnHeadingAt } from '../engine/turn';
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
  it('binds a continuous skinned body with normalised weights', () => {
    const fig = rig();
    let meshes = 0;
    const skinned: THREE.SkinnedMesh[] = [];
    fig.group.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      meshes += 1;
      skinned.push(mesh);
      expect(mesh.skeleton.bones.length).toBeGreaterThanOrEqual(21);
      const weights = mesh.geometry.getAttribute('skinWeight');
      const indices = mesh.geometry.getAttribute('skinIndex');
      expect(indices.count).toBe(weights.count);
      expect(weights.count).toBeGreaterThan(80);
      for (let i = 0; i < weights.count; i += 11) {
        let sum = 0;
        for (let slot = 0; slot < 4; slot += 1) {
          const w = weights.getComponent(i, slot);
          const bone = indices.getComponent(i, slot);
          expect(w).toBeGreaterThanOrEqual(0);
          expect(bone).toBeLessThan(mesh.skeleton.bones.length);
          sum += w;
        }
        expect(sum).toBeCloseTo(1, 5);
      }
    });
    // Trunk, both arms, neck and both legs: one surface each, not capsules.
    expect(meshes).toBeGreaterThanOrEqual(5);
    expect(skinned.every((mesh) => mesh.frustumCulled === false)).toBe(true);
    fig.dispose();
  });

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

  it('executes the halt turn as a heel-toe pivot and then closes the foot', () => {
    const fig = rig();
    fig.setTransform(0, 0, 0);
    pose(fig, BASE, 0, 0, 5);
    const plan = makeTurnPlan('halt', 90, 'right');
    const run = (p: number) => {
      fig.setTransform(0, 0, plan.angle * turnHeadingAt(plan, p));
      fig.animate({
        from: BASE,
        to: BASE,
        u: 1,
        gait: 'halt',
        stride: 0,
        time: 1 + p,
        eyes: 'front',
        headdress: 'worn',
        turn: { plan, progress: p },
      });
      return fig.getPose();
    };

    const pivot = run(0.2);
    expect(pivot.pivot).toBe('R');
    expect(pivot.turnPhase).toBe('pivot');
    expect(pivot.right.pitch).toBeLessThan(-2);
    expect(pivot.right.planted).toBe(true);
    expect(pivot.left.pitch).toBeGreaterThan(2);
    expect(pivot.left.planted).toBe(true);
    // The body rises onto the heel/ball instead of the knees folding under a
    // lift. The pivot leg stays close to extension; the outside leg bends only
    // as much as the raised heel requires.
    expect(pivot.hipY).toBeGreaterThan(0.938);
    expect(pivot.right.knee).toBeLessThan(14);
    expect(pivot.left.knee).toBeLessThan(28);

    const close = run(0.84);
    expect(close.left.planted).toBe(false);
    expect(close.left.ankle[1]).toBeGreaterThan(LEG.ankle);

    const done = run(1);
    expect(done.left.planted && done.right.planted).toBe(true);
    expect(Math.abs(done.left.pitch)).toBeLessThan(0.5);
    expect(fig.group.rotation.y).toBeCloseTo(plan.angle, 6);
    fig.dispose();
  });

  it('lifts the outside foot on the ball of the inside foot on a march turn', () => {
    const fig = rig();
    fig.setTransform(0, 0, 0);
    pose(fig, { ...BASE, gait: 'quick' }, 0.3, 0, 5);
    const plan = makeTurnPlan('march', 90, 'right');
    const p = 0.48;
    fig.setTransform(0, 0, plan.angle * turnHeadingAt(plan, p));
    fig.animate({
      from: { ...BASE, gait: 'quick' },
      to: { ...BASE, gait: 'quick' },
      u: 1,
      gait: 'quick',
      stride: 0.3,
      time: 2,
      eyes: 'front',
      headdress: 'worn',
      turn: { plan, progress: p },
    });
    const poseNow = fig.getPose();
    expect(poseNow.turnPhase).toBe('pivot');
    expect(poseNow.right.planted).toBe(true);
    expect(poseNow.left.planted).toBe(false);
    expect(poseNow.left.ankle[1]).toBeGreaterThan(LEG.ankle + 0.03);
    fig.dispose();
  });
});
