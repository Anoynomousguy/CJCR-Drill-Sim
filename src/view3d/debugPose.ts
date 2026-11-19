// Dev-only extreme-pose driver.
//
// The skin is only judged where it breaks: arms overhead, a deep squat, a hard
// torso twist, a full stride. Those poses are not drill commands, so this module
// applies them after the drill solver each frame. It is reachable from the app
// with `?pose=stride|twist|overhead|squat` (development only), which keeps the
// evidence reproducible from the running UI instead of a throwaway harness.

import * as THREE from 'three';
import type { Figure } from './figure';

export type DebugPoseName = 'overhead' | 'squat' | 'twist' | 'stride';

export const DEBUG_POSE_NAMES: readonly DebugPoseName[] = [
  'overhead',
  'squat',
  'twist',
  'stride',
];

export interface DebugPoseCamera {
  /** Offset in the figure's own frame: +Z is the way the cadet faces. */
  x: number;
  y: number;
  z: number;
  /** Height of the look-at point. */
  lookY: number;
}

export const DEBUG_POSE_CAMERA: Record<DebugPoseName, DebugPoseCamera> = {
  overhead: { x: 1.5, y: 1.6, z: 4.1, lookY: 1.25 },
  squat: { x: 3.1, y: 0.95, z: 0.25, lookY: 0.7 },
  twist: { x: 0.0, y: 1.35, z: 3.4, lookY: 1.1 },
  stride: { x: 3.5, y: 1.05, z: 0.15, lookY: 0.95 },
};

export function isDebugPose(value: string | null): value is DebugPoseName {
  return value !== null && (DEBUG_POSE_NAMES as readonly string[]).includes(value);
}

/** Read the requested pose from the URL; development builds only. */
export function readDebugPose(): DebugPoseName | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get('pose');
  return isDebugPose(value) ? value : null;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Aim a bone so its local -Y points along a body-space direction. The figure is
 * rotated as a whole, so the direction is taken through the group's quaternion
 * before being stored in the parent's local space.
 */
function aim(group: THREE.Group, bone: THREE.Bone, dir: [number, number, number]) {
  const world = v3(dir[0], dir[1], dir[2]).applyQuaternion(group.quaternion).normalize();
  const target = new THREE.Quaternion().setFromUnitVectors(v3(0, -1, 0), world);
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

/** Aim a bone with an explicit forward axis (feet, so the sole stays true). */
function aimFrame(
  group: THREE.Group,
  bone: THREE.Bone,
  down: [number, number, number],
  forward: [number, number, number],
) {
  const dw = v3(down[0], down[1], down[2]).applyQuaternion(group.quaternion).normalize();
  const fw = v3(forward[0], forward[1], forward[2]).applyQuaternion(group.quaternion);
  const y = dw.clone().negate().normalize();
  const z = fw.addScaledVector(y, -fw.dot(y)).normalize();
  const x = v3(0, 0, 0).crossVectors(y, z).normalize();
  const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

type Bones = Record<string, THREE.Bone>;

function bonesOf(group: THREE.Group): Bones {
  const names = [
    'pelvis', 'spine', 'chest', 'neck', 'head',
    'clav.L', 'upperArm.L', 'foreArm.L', 'hand.L',
    'clav.R', 'upperArm.R', 'foreArm.R', 'hand.R',
    'thigh.L', 'shin.L', 'foot.L', 'toe.L',
    'thigh.R', 'shin.R', 'foot.R', 'toe.R',
  ];
  const out: Bones = {};
  for (const name of names) {
    const bone = group.getObjectByName(name);
    if (bone) out[name] = bone as THREE.Bone;
  }
  return out;
}

function neutral(group: THREE.Group, b: Bones) {
  b.pelvis.position.set(0, 0.93, 0);
  b.pelvis.rotation.set(0, 0, 0);
  b.spine.rotation.set(0, 0, 0);
  b.chest.rotation.set(0, 0, 0);
  b.neck.rotation.set(0, 0, 0);
  b.head.rotation.set(0, 0, 0);
  b['clav.L'].rotation.set(0, 0, 0);
  b['clav.R'].rotation.set(0, 0, 0);
  for (const side of ['L', 'R'] as const) {
    const thigh = b[`thigh.${side}`];
    thigh.quaternion.identity();
    thigh.position.set(side === 'L' ? 0.097 : -0.097, 0.93, 0);
    b[`shin.${side}`].quaternion.identity();
    aimFrame(group, b[`foot.${side}`], [0, -1, 0], [0, 0, 1]);
    b[`toe.${side}`].rotation.set(0, 0, 0);
  }
}

/** Hip flexion and knee flexion in degrees; plantarflexion for the rear foot. */
function leg(
  group: THREE.Group,
  b: Bones,
  side: 'L' | 'R',
  hip: number,
  knee: number,
  plantar: number,
) {
  const hipRad = rad(hip);
  const kneeRad = rad(hip - knee);
  aim(group, b[`thigh.${side}`], [0, -Math.cos(hipRad), Math.sin(hipRad)]);
  aim(group, b[`shin.${side}`], [0, -Math.cos(kneeRad), Math.sin(kneeRad)]);
  const p = rad(plantar);
  if (plantar) {
    aimFrame(group, b[`foot.${side}`], [0, -Math.cos(p), -Math.sin(p)], [0, -Math.sin(p), Math.cos(p)]);
  } else {
    aimFrame(group, b[`foot.${side}`], [0, -1, 0], [0, 0, 1]);
  }
  b[`toe.${side}`].rotation.set(0, 0, 0);
}

const POSES: Record<DebugPoseName, (group: THREE.Group, b: Bones) => void> = {
  overhead(group, b) {
    b['clav.L'].rotation.set(0, 0, rad(12));
    b['clav.R'].rotation.set(0, 0, -rad(12));
    aim(group, b['upperArm.L'], [0.32, 0.95, 0.02]);
    aim(group, b['foreArm.L'], [0.16, 0.99, -0.02]);
    aim(group, b['hand.L'], [0.16, 0.99, -0.02]);
    aim(group, b['upperArm.R'], [-0.32, 0.95, 0.02]);
    aim(group, b['foreArm.R'], [-0.16, 0.99, -0.02]);
    aim(group, b['hand.R'], [-0.16, 0.99, -0.02]);
    b.head.rotation.set(rad(-6), 0, 0);
  },
  squat(group, b) {
    b.pelvis.position.set(0, 0.6, 0);
    b.pelvis.rotation.set(rad(14), 0, 0);
    b.spine.rotation.set(rad(7), 0, 0);
    b.chest.rotation.set(rad(3), 0, 0);
    b.neck.rotation.set(rad(-10), 0, 0);
    b.head.rotation.set(rad(-10), 0, 0);
    aim(group, b['upperArm.L'], [0.35, -0.3, 0.89]);
    aim(group, b['foreArm.L'], [0.2, 0.15, 0.97]);
    aim(group, b['hand.L'], [0.2, 0.15, 0.97]);
    aim(group, b['upperArm.R'], [-0.35, -0.3, 0.89]);
    aim(group, b['foreArm.R'], [-0.2, 0.15, 0.97]);
    aim(group, b['hand.R'], [-0.2, 0.15, 0.97]);
    for (const side of ['L', 'R'] as const) {
      b[`thigh.${side}`].position.set(side === 'L' ? 0.097 : -0.097, 0.6, 0);
    }
    leg(group, b, 'L', 49, 104, 0);
    leg(group, b, 'R', 49, 104, 0);
  },
  twist(group, b) {
    b.pelvis.position.set(0, 0.93, 0);
    b.pelvis.rotation.set(0, rad(-8), 0);
    b.spine.rotation.set(0, rad(16), 0);
    b.chest.rotation.set(0, rad(36), 0);
    b.neck.rotation.set(0, rad(8), 0);
    // The head turns partly with the chest: a diagnostic twist should read as
    // a twist, not as a frontal body with a counter-rotated head.
    b.head.rotation.set(0, rad(-14), 0);
    // Both arms hang, so the shoulder line is measured without a rifle grip
    // pulling one arm up. That keeps the twist symmetric and comparable.
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      aim(group, b[`upperArm.${side}`], [s * 0.18, -0.98, 0.02]);
      aim(group, b[`foreArm.${side}`], [s * 0.16, -0.99, 0.05]);
      aim(group, b[`hand.${side}`], [s * 0.16, -0.99, 0.05]);
    }
  },
  stride(group, b) {
    b.pelvis.position.set(0, 0.9, 0);
    b.pelvis.rotation.set(rad(4), 0, 0);
    b.spine.rotation.set(rad(2), 0, 0);
    b.chest.rotation.set(0, rad(-6), 0);
    b.head.rotation.set(0, rad(8), 0);
    for (const side of ['L', 'R'] as const) {
      b[`thigh.${side}`].position.set(side === 'L' ? 0.097 : -0.097, 0.9, 0);
    }
    leg(group, b, 'L', 48, 55, 0);
    leg(group, b, 'R', -20, 12, 35);
    aim(group, b['upperArm.L'], [-0.15, -0.9, -0.4]);
    aim(group, b['foreArm.L'], [-0.1, -0.5, 0.85]);
    aim(group, b['hand.L'], [-0.1, -0.5, 0.85]);
    aim(group, b['upperArm.R'], [0.15, -0.9, 0.4]);
    aim(group, b['foreArm.R'], [0.1, -0.5, 0.85]);
    aim(group, b['hand.R'], [0.1, -0.5, 0.85]);
  },
};

/** Apply the requested extreme pose to one figure, over the drill solve. */
export function applyDebugPose(figure: Figure, name: DebugPoseName) {
  const group = figure.group;
  const weapon = group.getObjectByName('weapon');
  if (weapon) weapon.visible = false;
  const colour = group.getObjectByName('colour');
  if (colour) colour.visible = false;
  const b = bonesOf(group);
  if (Object.keys(b).length < 20) return;
  neutral(group, b);
  POSES[name](group, b);
  // Rotations set with .rotation never reached the skin: the figure's transform
  // is updated elsewhere and the aim helpers only flush the bones they touch.
  // Flush the whole hierarchy so the skeleton actually sees this pose.
  group.updateMatrixWorld(true);
}
