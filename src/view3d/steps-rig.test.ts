import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UNIFORMS } from '../engine/constants';
import { LEG, gaitTargets } from '../engine/gait';
import { movementCode } from '../engine/individual';
import {
  makeChangeStepPlan,
  makeDressPlan,
  makeMarchPlan,
  makePacesPlan,
  sampleStepPlan,
  type StepPlan,
} from '../engine/steps';
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

function ankle(fig: Figure, side: 'L' | 'R'): THREE.Vector3 {
  const bone = fig.group.getObjectByName(`foot.${side}`);
  if (!bone) throw new Error(`no foot.${side}`);
  fig.group.updateMatrixWorld(true);
  return bone.getWorldPosition(new THREE.Vector3());
}

function ball(fig: Figure, side: 'L' | 'R'): THREE.Vector3 {
  const bone = fig.group.getObjectByName(`foot.${side}`);
  if (!bone) throw new Error(`no foot.${side}`);
  fig.group.updateMatrixWorld(true);
  return bone.localToWorld(new THREE.Vector3(0, -LEG.ankle, LEG.mtp));
}

function hand(fig: Figure, side: 'L' | 'R'): THREE.Vector3 {
  const bone = fig.group.getObjectByName(`hand.${side}`);
  if (!bone) throw new Error(`no hand.${side}`);
  fig.group.updateMatrixWorld(true);
  return bone.getWorldPosition(new THREE.Vector3());
}

function handBackY(fig: Figure, side: 'L' | 'R'): number {
  const bone = fig.group.getObjectByName(`hand.${side}`);
  if (!bone) throw new Error(`no hand.${side}`);
  fig.group.updateMatrixWorld(true);
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(
    bone.getWorldQuaternion(new THREE.Quaternion()),
  );
  return back.y;
}

function headYaw(fig: Figure): number {
  const bone = fig.group.getObjectByName('head');
  if (!bone) throw new Error('no head');
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    bone.getWorldQuaternion(new THREE.Quaternion()),
  );
  return (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
}

/**
 * Drive the rig exactly as Stage3D does: the body at the plan's displacement
 * and the feet from the step plan. The only difference is the camera.
 */
function runPlan(fig: Figure, plan: StepPlan, raw: number, time: number) {
  const step = sampleStepPlan(plan, raw);
  const progress = Math.min(1, raw / plan.moveEnd);
  const bx = plan.total.x * progress;
  const bz = plan.total.z * progress;
  fig.setTransform(bx, bz, 0);
  fig.animate({
    from: BASE,
    to: BASE,
    u: 1,
    gait: 'halt',
    stride: 0,
    time,
    eyes: 'front',
    headdress: 'worn',
    feet: { left: step.left, right: step.right, hipY: step.hipY },
  });
  return { step, bx, bz };
}

describe('step plans on the live rig', () => {
  it('holds each planted foot in one world position while the body travels 70 cm', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makePacesPlan({ paces: 2, total: { x: 0, z: 0.7 } })!;
    const leftWorld: number[] = [];
    const rightWorld: number[] = [];
    for (const raw of [0.2, 0.35, 0.5, 0.65]) {
      const { step, bz } = runPlan(fig, plan, raw, raw);
      expect(step.left.planted, `left planted ${raw}`).toBe(true);
      const l = ankle(fig, 'L');
      expect(Math.abs(l.z - (bz + step.left.z)), `left target ${raw}`).toBeLessThan(0.008);
      // The heel rolls up over the ball; the ball is the fixed contact.
      leftWorld.push(ball(fig, 'L').z);
    }
    for (const raw of [0.55, 0.7, 0.85]) {
      const { step, bz } = runPlan(fig, plan, raw, raw);
      expect(step.right.planted, `right planted ${raw}`).toBe(true);
      const r = ankle(fig, 'R');
      expect(Math.abs(r.z - (bz + step.right.z)), `right target ${raw}`).toBeLessThan(0.008);
      rightWorld.push(ball(fig, 'R').z);
    }
    // Each stance is one fixed world ball contact: the boot at 35 cm is
    // 0.451 m ahead of the start (its ball is a MTP lever ahead of the ankle),
    // the one at 70 cm is 0.801 m.
    expect(Math.max(...leftWorld) - Math.min(...leftWorld)).toBeLessThan(0.006);
    expect(Math.max(...rightWorld) - Math.min(...rightWorld)).toBeLessThan(0.006);
    expect(leftWorld[0]).toBeCloseTo(0.35 + LEG.mtp * Math.cos(Math.PI / 12), 2);
    expect(rightWorld[0]).toBeCloseTo(0.7 + LEG.mtp * Math.cos(Math.PI / 12), 2);
    expect(rightWorld[0] - leftWorld[0]).toBeCloseTo(0.35, 2);
    fig.dispose();
  });

  it('lowers the pelvis enough to keep the 35 cm stance reachable', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makePacesPlan({ paces: 2, total: { x: 0, z: 0.7 } })!;
    const stand = runPlan(fig, plan, 0, 0).step.hipY;
    const step = runPlan(fig, plan, 0.55, 0.55);
    expect(step.step.hipY).toBeLessThan(stand - 0.02);
    expect(Math.abs(fig.getPose().hipY - step.step.hipY)).toBeLessThan(0.01);
    // The ankle is physically at the target, not clamped short of it.
    expect(Math.abs(ankle(fig, 'R').y - LEG.ankle)).toBeLessThan(0.005);
    fig.dispose();
  });

  it('keeps the arms at the sides and the head front in paces at the halt', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makePacesPlan({ paces: 2, total: { x: 0, z: 0.7 } })!;
    runPlan(fig, plan, 0.5, 0.5);
    expect(hand(fig, 'R').y).toBeLessThan(1.02);
    expect(hand(fig, 'L').y).toBeLessThan(1.02);
    expect(Math.abs(headYaw(fig))).toBeLessThan(2);
    // Shoulders stay square: no thoracic rotation on a pace at the halt.
    const thoracic = fig.getAngles().find((a) => a.joint === 'thoracicRotation');
    expect(Math.abs(thoracic?.value ?? 0)).toBeLessThan(2);
    fig.dispose();
  });

  it('right-dresses on the counts: arm down on ONE, up on TWO, held on THREE', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const code = movementCode({ id: 'dress-cadet', role: 'cadet', rank: 0 });
    const animate = (t: number) => {
      fig.animate({
        from: { ...BASE, eyes: 'right' },
        to: { ...BASE, eyes: 'right' },
        u: 1,
        gait: 'halt',
        stride: 0,
        time: t,
        eyes: 'right',
        headdress: 'worn',
        dressing: true,
        dressT: t,
        eyesAmount: Math.max(0, Math.min(1, (t - 0.2) / 0.18)),
        code,
      });
    };

    animate(0.1);
    // ONE is the check pace; the arm must still be at the side, relaxed.
    expect(hand(fig, 'R').y).toBeLessThan(0.98);
    expect(Math.abs(headYaw(fig))).toBeLessThan(3);
    expect(fig.getPose().fingers.right).toBeGreaterThan(0.1);

    animate(0.35);
    // TWO raises the arm and turns the head to the right.
    expect(hand(fig, 'R').y).toBeGreaterThan(1.25);
    expect(Math.abs(headYaw(fig))).toBeGreaterThan(25);
    // The dressing hand is closed as in the position of attention, back up.
    expect(fig.getPose().fingers.right).toBeGreaterThan(0.1);
    expect(handBackY(fig, 'R')).toBeGreaterThan(0.8);
    const raised = hand(fig, 'R').y;

    animate(0.45);
    // THREE holds the arm while the short paces correct the dressing.
    const held = hand(fig, 'R').y;
    expect(handBackY(fig, 'R')).toBeGreaterThan(0.8);
    expect(fig.getPose().fingers.right).toBeGreaterThan(0.1);
    expect(held).toBeGreaterThan(1.35);
    animate(0.6);
    expect(hand(fig, 'R').y).toBeCloseTo(held, 2);
    expect(Math.abs(headYaw(fig))).toBeGreaterThan(25);
    fig.dispose();
  });

  it('right-dresses while armed by raising the left arm and keeping the rifle', () => {
    const fig = createFigure({ palette, detail: 'low' }, true, false);
    const code = movementCode({ id: 'dress-armed', role: 'cadet', rank: 0 });
    const armed = { ...BASE, weapon: 'order' as const };
    const at = (t: number) => {
      fig.animate({
        from: armed,
        to: armed,
        u: 1,
        gait: 'halt',
        stride: 0,
        time: t,
        eyes: 'right',
        headdress: 'worn',
        dressing: true,
        dressT: t,
        eyesAmount: Math.max(0, Math.min(1, (t - 0.2) / 0.18)),
        code,
      });
      return { left: hand(fig, 'L'), right: hand(fig, 'R') };
    };

    const one = at(0.1);
    expect(one.left.y).toBeLessThan(1.0);
    expect(one.right.y).toBeGreaterThan(0.8);
    expect(fig.getPose().fingers.left).toBeGreaterThan(0.1);
    const two = at(0.35);
    // The free arm is horizontal at shoulder height, on the left, hand closed
    // with the back up, while the right hand keeps the rifle at the order.
    expect(two.left.y).toBeGreaterThan(1.25);
    expect(two.left.x - fig.group.position.x).toBeGreaterThan(0.45);
    expect(fig.getPose().fingers.left).toBeGreaterThan(0.1);
    expect(handBackY(fig, 'L')).toBeGreaterThan(0.8);
    expect(fig.getPose().fingers.right).toBeGreaterThan(0.8);
    expect(Math.abs(two.right.y - one.right.y)).toBeLessThan(0.005);
    expect(Math.abs(two.right.x - one.right.x)).toBeLessThan(0.005);
    fig.dispose();
  });

  it('the marker and commander keep the arm down and the head front in a dress', () => {
    for (const role of ['marker', 'commander'] as const) {
      const fig = createFigure({ palette, detail: 'low' }, false, false);
      const code = movementCode({
        id: `dress-${role}`,
        role,
        rank: role === 'commander' ? 99 : 0,
      });
      fig.animate({
        from: { ...BASE, eyes: 'right' },
        to: { ...BASE, eyes: 'right' },
        u: 1,
        gait: 'halt',
        stride: 0,
        time: 0.6,
        eyes: 'right',
        headdress: 'worn',
        dressing: true,
        dressT: 0.6,
        eyesAmount: 1,
        role,
        code,
      });
      expect(hand(fig, 'R').y, role).toBeLessThan(1.05);
      expect(Math.abs(headYaw(fig)), role).toBeLessThan(4);
      fig.dispose();
    }
  });

  it('bends the right knee over the raised right heel in a right dress', () => {
    // The check pace is a weight shift onto the right boot, not a stride. If
    // the pelvis travels with the left boot again, the right leg straightens
    // and this drops back to ~11 degrees while every contact still passes.
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const plan = makeDressPlan({ total: { x: 0, z: 0 }, marker: false, commander: false })!;
    const step = sampleStepPlan(plan, 0.5);
    fig.setTransform(step.body.x, step.body.z, 0);
    fig.animate({
      from: BASE,
      to: BASE,
      u: 1,
      gait: 'halt',
      stride: 0,
      time: 0.5,
      eyes: 'right',
      headdress: 'worn',
      dressing: true,
      dressT: 0.5,
      eyesAmount: 1,
      feet: { left: step.left, right: step.right, hipY: step.hipY },
    });
    const pose = fig.getPose();
    const knee = (side: 'L' | 'R') =>
      fig.getAngles().find((a) => a.joint === 'kneeFlexion' && a.side === side)!.value;
    expect(knee('R')).toBeGreaterThan(35);
    expect(knee('R')).toBeLessThan(65);
    // The left leg is the extended check-pace leg: nearly straight.
    expect(knee('L')).toBeLessThan(20);
    expect(knee('R') - knee('L')).toBeGreaterThan(25);
    // The right heel is on its ball, and the left ankle is a half pace ahead.
    expect(pose.right.ankle[1]).toBeCloseTo(0.099, 2);
    expect(pose.right.pitch).toBeCloseTo(24, 0);
    expect(pose.left.ankle[2]).toBeCloseTo(0.3, 1);
    expect(pose.hipY).toBeLessThan(0.9);
    fig.dispose();
  });

  it('opposes each arm to its own leg through a quick march', () => {
    // Arm swing is driven by the plan's feet, not the free gait cycle. A phase
    // mismatch put each arm forward with the leg on its own side (a bear
    // march) even though the legs and contacts were correct.
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const start = gaitTargets('quick', 0.1);
    const plan = makeMarchPlan({
      start: { left: start.left, right: start.right },
      paces: 6,
      lead: 'L',
      distance: 4.5,
    })!;
    const march = { ...BASE, gait: 'quick' as const };
    let checked = 0;
    for (const raw of [0.14, 0.3, 0.46, 0.62, 0.78, 0.94]) {
      const step = sampleStepPlan(plan, raw);
      fig.setTransform(step.body.x, step.body.z, 0);
      fig.animate({
        from: march,
        to: march,
        u: 1,
        gait: 'quick',
        stride: 0.75,
        time: raw * 2,
        eyes: 'front',
        headdress: 'worn',
        feet: { left: step.left, right: step.right, hipY: step.hipY },
      });
      const pose = fig.getPose();
      const shoulder = (side: 'L' | 'R') =>
        fig.getAngles().find((a) => a.joint === 'shoulderFlexion' && a.side === side)!.value;
      for (const side of ['L', 'R'] as const) {
        const foot = side === 'L' ? pose.left.ankle[2] : pose.right.ankle[2];
        const arm = shoulder(side);
        if (Math.abs(foot) < 0.08) continue;
        expect(foot * arm, `${side} foot ${foot.toFixed(2)} arm ${arm.toFixed(1)} at ${raw}`).toBeLessThan(0);
        checked += 1;
      }
    }
    // Six samples should give both feet a clear forward/back position often
    // enough that the test cannot pass on one lucky phase.
    expect(checked).toBeGreaterThanOrEqual(6);
    fig.dispose();
  });

  it('cuts the arms to the sides on the change step’s middle count', () => {
    // The manual cuts the arms to the sides on TWO and picks the swing up on
    // THREE. Without the cut the plan's own foot positions drive the marching
    // swing straight through the check.
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const start = gaitTargets('quick', 0.1);
    const marchPlan = makeMarchPlan({
      start: { left: start.left, right: start.right },
      paces: 6,
      lead: 'L',
      distance: 4.5,
    })!;
    const seam = sampleStepPlan(marchPlan, 1);
    const plan = makeChangeStepPlan({ startLeft: seam.left, startRight: seam.right })!;
    const march = { ...BASE, gait: 'quick' as const };
    const at = (armCut: number) => {
      const step = sampleStepPlan(plan, 0.7);
      fig.setTransform(step.body.x, step.body.z, 0);
      for (let i = 0; i < 24; i += 1) {
        fig.animate({
          from: march,
          to: march,
          u: 1,
          gait: 'quick',
          stride: 0.75,
          time: 0.8 + i / 60,
          eyes: 'front',
          headdress: 'worn',
          feet: { left: step.left, right: step.right, hipY: step.hipY },
          armCut,
        });
      }
      const forward = (side: 'L' | 'R') => hand(fig, side).z - fig.group.position.z;
      return { l: forward('L'), r: forward('R') };
    };
    const cut = at(1);
    const swinging = at(0);
    expect(Math.abs(cut.l)).toBeLessThan(0.12);
    expect(Math.abs(cut.r)).toBeLessThan(0.12);
    expect(Math.abs(swinging.l) + Math.abs(swinging.r)).toBeGreaterThan(
      Math.abs(cut.l) + Math.abs(cut.r) + 0.08,
    );
    fig.dispose();
  });

  it('cuts a held dressing arm on EYES FRONT instead of snapping it down', () => {
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    const code = movementCode({ id: 'dress-cut', role: 'cadet', rank: 0 });
    const at = (hold: number) => {
      fig.animate({
        from: BASE,
        to: BASE,
        u: 1,
        gait: 'halt',
        stride: 0,
        time: 1 + hold,
        eyes: 'front',
        headdress: 'worn',
        dressT: 1,
        armFromDress: hold,
        code,
      });
      return hand(fig, 'R').y;
    };
    const held = at(1);
    const half = at(0.5);
    const down = at(0);
    expect(held).toBeGreaterThan(1.25);
    expect(half).toBeLessThan(held - 0.1);
    expect(half).toBeGreaterThan(down + 0.05);
    expect(down).toBeLessThan(0.98);
    fig.dispose();
  });
});
