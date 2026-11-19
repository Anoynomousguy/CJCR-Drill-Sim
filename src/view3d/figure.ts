import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  EYES_RIGHT,
  reading,
  clampJoint,
  DRILL_SPINE,
  type BodyMode,
  type JointReading,
} from '../engine/anatomy';
import {
  ARM_MAX_REACH,
  BODY,
  DRESS_HANDS,
  DRESS_LEFT_RAISED,
  PIKE,
  POSTURE_HANDS,
  armedSaluteHand,
  handIsGripping,
  levelElbow,
  levelForearmElbow,
  rifleGripElbow,
  lerpV,
  mixCarriage,
  poseTargets,
  swingHand,
  type Carriage,
  type Rot,
  type Vec3,
} from '../engine/pose';
import {
  GAIT_SPEC,
  LEG,
  blendTargets,
  gaitCycle,
  gaitTargets,
  solveKnee,
  standTargets,
  turnPose,
  type FootTarget,
  type GaitTargets,
} from '../engine/gait';
import { PACE_HALF } from '../engine/constants';
import { turnFootwork, type TurnFootwork, type TurnPlan } from '../engine/turn';
import type { RifleSample } from '../engine/rifle';
import type { MovementCode } from '../engine/individual';
import type { Role, Snapshot } from '../engine/types';
import {
  MUSCLES,
  muscleActivationFor,
  type MuscleBone,
  type MuscleDef,
  type Side,
} from '../engine/muscles';
import { buildSkin, type SkinBoneName } from './skin';

type V3 = Vec3;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (v: number) => (v * 180) / Math.PI;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const SKIN = '#c79a72';

const HIP = BODY.hip;
const SPINE_Y = BODY.spine;
const CHEST_Y = BODY.chest;
const SHOULDER_Y = BODY.shoulderY;
const NECK_Y = BODY.neck;
const HEAD_Y = BODY.head;
const FEMUR = BODY.femur;
const TIBIA = BODY.tibia;
const HUMERUS = BODY.humerus;
const FOREARM = BODY.forearm;

export interface FigurePalette {
  tunic: string;
  tunicShade: string;
  trousers: string;
  shirt: string;
  accent: string;
  beret: string;
  belt: string;
  boots: string;
  brassard: string;
}

export interface FigureKit {
  palette: FigurePalette;
  detail: 'low' | 'high';
}

export interface FigureAnim {
  from: Snapshot;
  to: Snapshot;
  u: number;
  gait: Snapshot['gait'];
  stride: number;
  time: number;
  eyes: Snapshot['eyes'];
  headdress: Snapshot['headdress'];
  dressing?: boolean;
  /** Progress through a right dress, for the per-count arm and head targets. */
  dressT?: number;
  /** Right dress: this person is in the current front rank and raises the arm. */
  dressArm?: boolean;
  /** 0..1 head/eye turn, so a dress looks right on count two, not on one. */
  eyesAmount?: number;
  /** 1 = right arm still held at the dressing position; cuts to 0 on EYES FRONT. */
  armFromDress?: number;
  /** Explicit feet from the step-plan engine, in body space, with solved pelvis height. */
  feet?: { left: FootTarget; right: FootTarget; hipY: number };
  /** 0..1 arm hold for a movement that cuts the arms to the sides (change step). */
  armCut?: number;
  /** 0..1 right-arm salute: 1 through the standard pause, 0 after the cut. */
  saluteArm?: number;
  /** 0..1 commander's salute on EYES RIGHT, cut on EYES FRONT. */
  commanderSalute?: number;
  /** A commanded turn's manual breakdown; omit for free-standing turns. */
  turn?: { plan: TurnPlan; progress: number };
  /** Count-sampled Lee-Enfield carriage and hand grips. */
  rifle?: RifleSample;
  /** Who this is: the marker and commander do not move like the ranks. */
  role?: Role;
  /** This soldier's own beat and arm swing. */
  code?: MovementCode;
}

export interface FigureFoot {
  ankle: [number, number, number];
  pitch: number;
  toe: number;
  yaw: number;
  planted: boolean;
  knee: number;
}

export interface FigurePose {
  hipY: number;
  left: FigureFoot;
  right: FigureFoot;
  fingers: { left: number; right: number };
  /** Heading change in degrees per second; + is a left turn in this frame. */
  turn: number;
  turnPhase?: TurnFootwork['phase'];
  pivot?: 'L' | 'R';
  /** 0 = standing, 1 = full gait. */
  walking: number;
}

export interface Figure {
  group: THREE.Group;
  setTransform: (x: number, z: number, heading: number) => void;
  setHeight: (h: number) => void;
  setMode: (mode: BodyMode) => void;
  getAngles: () => JointReading[];
  getCarriage: () => { weapon: Carriage | null; colour: Carriage | null };
  getPose: () => FigurePose;
  /** Muscles working hardest right now, for the anatomy readout. */
  getMuscles: () => { name: string; activation: number; peak: number }[];
  animate: (anim: FigureAnim) => void;
  tick: (dt: number, time: number) => void;
  dispose: () => void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Quaternion whose local +Y is `proximal`, local +Z is `forward`. */
function frameQuat(proximal: THREE.Vector3, forward: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const y = proximal.clone().normalize();
  const z = forward.clone().addScaledVector(y, -forward.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Orient a limb so its local -Y points along `bone` and local +Z stays as
 * close to forward as the bone allows. The forward reference matters: the knee
 * and elbow are hinges about local X, so if the frame rolls when a limb tilts,
 * a positive flexion bends the wrong way. Using world up for a tilted femur
 * made the shin swing forward as the knee flexed and the foot fell 15 cm short
 * of its target; world forward is stable through the whole stride.
 */
function limbQuat(bone: THREE.Vector3): THREE.Quaternion {
  const y = bone.clone().negate().normalize();
  const ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(ref.dot(y)) > 0.98) ref.set(0, 1, 0);
  const z = ref.clone().addScaledVector(y, -ref.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function wrapAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Put a chest-space carriage on its group: butt at the origin, barrel on +Y. */
function placeCarriage(group: THREE.Object3D, frame: Carriage) {
  const dir = new THREE.Vector3(frame.dir[0], frame.dir[1], frame.dir[2]).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  quat.multiply(new THREE.Quaternion().setFromAxisAngle(UP, rad(frame.roll ?? 0)));
  group.quaternion.copy(quat);
  group.position.set(frame.butt[0], frame.butt[1], frame.butt[2]);
}

export function createFigure(kit: FigureKit, hasRifle: boolean, hasColour: boolean): Figure {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const pal = kit.palette;
  const fine = kit.detail === 'high';

  const mat = (color: string, rough = 0.88, metal = 0.02) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const mats = {
    tunic: mat(pal.tunic),
    tunicShade: mat(pal.tunicShade),
    trousers: mat(pal.trousers),
    shirt: mat(pal.shirt, 0.75),
    accent: mat(pal.accent, 0.6, 0.25),
    beret: mat(pal.beret, 0.95),
    belt: mat(pal.belt, 0.55, 0.15),
    boots: mat(pal.boots, 0.45, 0.1),
    brassard: mat(pal.brassard, 0.8),
    skin: mat(SKIN, 0.72),
    rifleWood: mat('#6b4a2e', 0.62),
    rifleMetal: mat('#3c4045', 0.4, 0.65),
    badge: mat('#cfb25c', 0.35, 0.8),
    hair: mat('#2a211b', 1),
    bone: mat('#ece4d2', 0.62),
    cartilage: mat('#93a9bb', 0.42, 0.1),
    ligament: mat('#c9b489', 0.7),
    muscle: mat('#a8443a', 0.8),
    tendon: mat('#dccca6', 0.62),
    socket: mat('#2b211c', 0.9),
  };
  const uniformMats = [
    mats.tunic, mats.tunicShade, mats.trousers, mats.shirt, mats.accent, mats.beret,
    mats.belt, mats.boots, mats.brassard, mats.skin, mats.badge, mats.hair,
  ];
  const allMats = Object.values(mats);

  const uniformMeshes: THREE.Object3D[] = [];
  const skeletonMeshes: THREE.Object3D[] = [];
  const muscleMeshes: THREE.Object3D[] = [];

  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    pos: V3,
    rot?: Rot,
    layer: 'uniform' | 'bone' | 'muscle' = 'uniform',
  ) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = layer === 'uniform';
    mesh.receiveShadow = layer === 'uniform';
    parent.add(mesh);
    if (layer === 'uniform') uniformMeshes.push(mesh);
    else if (layer === 'bone') skeletonMeshes.push(mesh);
    else muscleMeshes.push(mesh);
    return mesh;
  };
  const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r);

  const bone = (parent: THREE.Object3D, length: number, radius: number, x = 0, z = 0, material = mats.bone) => {
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.008, length - radius * 2), 4, 9);
    return add(parent, geo, material, [x, -length / 2, z], undefined, 'bone');
  };
  const jointBall = (parent: THREE.Object3D, radius: number, x: number, y: number, z: number) =>
    add(parent, new THREE.SphereGeometry(radius, fine ? 14 : 8, fine ? 10 : 6), mats.cartilage, [x, y, z], undefined, 'bone');

  // ================================================================ skeleton
  // Every joint is a Bone, not a Group: the skin is bound to these objects, so
  // the surface deforms with the same transforms the drill solver produces.
  const pelvis = new THREE.Bone();
  pelvis.name = 'pelvis';
  pelvis.position.y = HIP;
  body.add(pelvis);

  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.y = SPINE_Y;
  pelvis.add(spine);

  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.y = CHEST_Y;
  spine.add(chest);

  const neck = new THREE.Bone();
  neck.name = 'neck';
  neck.position.y = NECK_Y;
  chest.add(neck);

  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = HEAD_Y;
  neck.add(head);

  // ----------------------------------------------------------------- pelvis
  const iliumL = add(pelvis, new THREE.SphereGeometry(0.072, fine ? 14 : 8, 8), mats.bone, [0.068, 0.02, -0.015], undefined, 'bone');
  iliumL.scale.set(1.3, 1.15, 0.6);
  const iliumR = add(pelvis, new THREE.SphereGeometry(0.072, fine ? 14 : 8, 8), mats.bone, [-0.068, 0.02, -0.015], undefined, 'bone');
  iliumR.scale.set(1.3, 1.15, 0.6);
  add(pelvis, rbox(0.09, 0.13, 0.05, 0.015), mats.bone, [0, 0.01, -0.055], undefined, 'bone');
  add(pelvis, rbox(0.075, 0.07, 0.045, 0.02), mats.cartilage, [0, 0.01, 0.04], undefined, 'bone');
  // hip sockets, where the femora actually sit
  jointBall(pelvis, 0.032, LEG.hipX, 0.0, 0);
  jointBall(pelvis, 0.032, -LEG.hipX, 0.0, 0);

  // ------------------------------------------------------------------ spine
  for (let i = 0; i < 5; i += 1) {
    add(spine, rbox(0.052, 0.022, 0.048, 0.008), mats.bone, [0, 0.005 + i * 0.028, -0.02], undefined, 'bone');
  }
  add(spine, rbox(0.12, 0.05, 0.03, 0.012), mats.bone, [0, 0.06, -0.045], undefined, 'bone');

  // ------------------------------------------------------------------ chest
  // The tunic hangs on the skinned trunk now; only the fittings are meshes. A
  // narrow placket and buttons instead of two slabs, and epaulettes that sit on
  // the slope of the trapezius instead of floating above it.
  add(chest, rbox(0.034, 0.3, 0.016, 0.008), mats.tunicShade, [0, 0.135, 0.112]);
  add(chest, rbox(0.075, 0.055, 0.025, 0.012), mats.shirt, [0, 0.262, 0.072]);
  const collar = add(
    chest,
    new THREE.CylinderGeometry(0.076, 0.09, 0.062, 18, 1, true),
    mats.tunicShade,
    [0, 0.29, 0.0],
  );
  collar.scale.z = 0.88;
  if (fine) {
    for (let i = 0; i < 4; i += 1) {
      add(chest, new THREE.SphereGeometry(0.011, 8, 8), mats.badge, [0.0, 0.0 + i * 0.068, 0.118]);
    }
  }

  add(chest, rbox(0.045, 0.24, 0.025, 0.01), mats.bone, [0, 0.15, 0.1], undefined, 'bone');
  for (let i = 0; i < 7; i += 1) {
    const r = 0.092 + i * 0.005;
    const geo = new THREE.TorusGeometry(r, 0.0075, 5, 20);
    const rib = add(chest, geo, mats.bone, [0, 0.245 - i * 0.03, -0.005], undefined, 'bone');
    rib.rotation.x = Math.PI / 2 + 0.12;
    rib.scale.set(1.08, 1, 0.78);
  }
  const clavL = add(chest, new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6), mats.bone, [0.1, 0.3, 0.03], undefined, 'bone');
  clavL.rotation.z = Math.PI / 2 - 0.2;
  const clavR = add(chest, new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6), mats.bone, [-0.1, 0.3, 0.03], undefined, 'bone');
  clavR.rotation.z = -(Math.PI / 2 - 0.2);
  const scapL = add(chest, rbox(0.1, 0.13, 0.02, 0.008), mats.bone, [0.11, 0.2, -0.095], [0, 0.25, 0.15], 'bone');
  const scapR = add(chest, rbox(0.1, 0.13, 0.02, 0.008), mats.bone, [-0.11, 0.2, -0.095], [0, -0.25, -0.15], 'bone');
  void scapL;
  void scapR;

  // ------------------------------------------------------------------- neck
  for (let i = 0; i < 3; i += 1) {
    add(neck, rbox(0.042, 0.016, 0.038, 0.006), mats.bone, [0, 0.0 + i * 0.024, -0.005], undefined, 'bone');
  }

  // ------------------------------------------------------------------- head
  const skull = add(head, new THREE.SphereGeometry(0.099, fine ? 22 : 12, fine ? 16 : 10), mats.skin, [0, 0.1, 0]);
  skull.scale.set(0.9, 1.1, 0.98);
  const jaw = add(head, new THREE.SphereGeometry(0.066, 14, 10), mats.skin, [0, 0.036, 0.022]);
  jaw.scale.set(0.86, 0.78, 0.95);
  add(head, new THREE.SphereGeometry(0.021, 8, 8), mats.skin, [0, 0.092, 0.098]);
  add(head, new THREE.SphereGeometry(0.014, 8, 8), mats.skin, [-0.086, 0.1, 0.004]);
  add(head, new THREE.SphereGeometry(0.014, 8, 8), mats.skin, [0.086, 0.1, 0.004]);
  add(head, new THREE.SphereGeometry(0.035, 10, 10), mats.hair, [0, 0.07, -0.06]);
  // Eyes and a mouth, so the face reads at the distance a viewer sees it.
  add(head, new THREE.SphereGeometry(0.0085, 10, 8), mats.socket, [-0.033, 0.108, 0.092]);
  add(head, new THREE.SphereGeometry(0.0085, 10, 8), mats.socket, [0.033, 0.108, 0.092]);
  add(head, rbox(0.036, 0.006, 0.008, 0.002), mats.socket, [0, 0.052, 0.092]);

  const cranium = add(head, new THREE.SphereGeometry(0.09, fine ? 18 : 10, fine ? 14 : 8), mats.bone, [0, 0.11, 0], undefined, 'bone');
  cranium.scale.set(0.95, 1.08, 1.0);
  add(head, rbox(0.1, 0.05, 0.075, 0.02), mats.bone, [0, 0.035, 0.03], undefined, 'bone');
  add(head, new THREE.SphereGeometry(0.021, 8, 8), mats.socket, [-0.038, 0.11, 0.078], undefined, 'bone');
  add(head, new THREE.SphereGeometry(0.021, 8, 8), mats.socket, [0.038, 0.11, 0.078], undefined, 'bone');
  add(head, rbox(0.018, 0.028, 0.02, 0.006), mats.socket, [0, 0.075, 0.092], undefined, 'bone');

  const beret = new THREE.Group();
  beret.position.set(0, 0.2, -0.006);
  beret.rotation.z = -0.06;
  beret.rotation.x = -0.04;
  head.add(beret);
  const crown = add(beret, new THREE.SphereGeometry(0.112, 18, 12), mats.beret, [0.014, 0.008, 0.01]);
  crown.scale.set(1.02, 0.34, 0.99);
  add(beret, new THREE.TorusGeometry(0.095, 0.012, 8, 22), mats.beret, [0.004, -0.018, 0.005], [Math.PI / 2, 0, 0]);
  add(beret, rbox(0.034, 0.03, 0.012, 0.006), mats.badge, [0.0, 0.0, 0.107]);

  // ==================================================================== arms
  interface HandRig {
    group: THREE.Bone;
    joints: THREE.Group[][];
    thumb: THREE.Group[];
    curl: number;
  }

  const makeHand = (side: 1 | -1): HandRig => {
    const hand = new THREE.Bone();
    add(hand, rbox(0.072, 0.088, 0.026, 0.012), mats.skin, [0, -0.044, 0]);
    add(hand, rbox(0.062, 0.07, 0.018, 0.008), mats.bone, [0, -0.05, 0.006], undefined, 'bone');
    add(hand, new THREE.SphereGeometry(0.024, 10, 8), mats.skin, [0, -0.004, 0]);

    const joints: THREE.Group[][] = [];
    // The thumb is radial. With the palm facing the thigh the thumb points
    // forward on both sides, so the whole hand mirrors about the midline.
    const fingers: [number, [number, number, number], number][] = [
      [-0.027 * side, [0.032, 0.022, 0.018], 0.0075],
      [-0.009 * side, [0.036, 0.025, 0.019], 0.0078],
      [0.01 * side, [0.034, 0.024, 0.018], 0.0075],
      [0.028 * side, [0.027, 0.018, 0.015], 0.0068],
    ];
    for (const [x, lengths, radius] of fingers) {
      const chain: THREE.Group[] = [];
      const mcp = new THREE.Group();
      mcp.position.set(x, -0.088, 0.003);
      hand.add(mcp);
      let parent: THREE.Group = mcp;
      chain.push(mcp);
      for (const length of lengths) {
        add(parent, new THREE.CapsuleGeometry(radius, length - radius * 2, 3, 6), mats.skin, [0, -length / 2, 0]);
        add(parent, new THREE.CapsuleGeometry(radius * 0.52, length * 0.78, 2, 5), mats.bone, [0, -length / 2, 0], undefined, 'bone');
        const joint = new THREE.Group();
        joint.position.y = -length;
        parent.add(joint);
        parent = joint;
        chain.push(joint);
      }
      chain.pop();
      joints.push(chain);
    }

    // Thumb: metacarpal then proximal and distal phalanges, opposed across the palm.
    const thumbBase = new THREE.Group();
    thumbBase.position.set(-0.034 * side, -0.026, 0.006);
    thumbBase.rotation.z = 0.55 * side;
    thumbBase.rotation.x = 0.35;
    hand.add(thumbBase);
    add(thumbBase, new THREE.CapsuleGeometry(0.0095, 0.026, 3, 6), mats.skin, [0, -0.02, 0]);
    add(thumbBase, new THREE.CapsuleGeometry(0.005, 0.024, 2, 5), mats.bone, [0, -0.02, 0], undefined, 'bone');
    const thumbMcp = new THREE.Group();
    thumbMcp.position.y = -0.038;
    thumbBase.add(thumbMcp);
    add(thumbMcp, new THREE.CapsuleGeometry(0.0082, 0.022, 3, 6), mats.skin, [0, -0.014, 0]);
    add(thumbMcp, new THREE.CapsuleGeometry(0.0045, 0.02, 2, 5), mats.bone, [0, -0.014, 0], undefined, 'bone');
    const thumbIp = new THREE.Group();
    thumbIp.position.y = -0.028;
    thumbMcp.add(thumbIp);
    add(thumbIp, new THREE.CapsuleGeometry(0.0072, 0.018, 3, 6), mats.skin, [0, -0.012, 0]);
    add(thumbIp, new THREE.CapsuleGeometry(0.004, 0.016, 2, 5), mats.bone, [0, -0.012, 0], undefined, 'bone');

    const rig: HandRig = { group: hand, joints, thumb: [thumbBase, thumbMcp, thumbIp], curl: 0.2 };
    setHandCurl(rig, 0.2);
    return rig;
  };

  function setHandCurl(hand: HandRig, amount: number) {
    const a = clamp01(amount);
    hand.curl = a;
    hand.joints.forEach((chain, i) => {
      const cascade = [0.92, 1, 0.97, 0.9][i] ?? 1;
      chain[0].rotation.x = rad(6 + a * 74 * cascade);
      chain[1].rotation.x = rad(8 + a * 92 * cascade);
      chain[2].rotation.x = rad(5 + a * 55 * cascade);
    });
    hand.thumb[0].rotation.x = 0.35 + a * 0.55;
    hand.thumb[1].rotation.x = 0.15 + a * 0.75;
    hand.thumb[2].rotation.x = 0.1 + a * 0.65;
  }

  interface ArmRig {
    /** Sternoclavicular joint: lets the shoulder girdle lead the arm. */
    clav: THREE.Bone;
    shoulder: THREE.Bone;
    upper: THREE.Bone;
    elbow: THREE.Bone;
    hand: HandRig;
  }

  const makeArm = (side: 1 | -1): ArmRig => {
    const suffix = side === 1 ? 'L' : 'R';
    const clav = new THREE.Bone();
    clav.name = `clav.${suffix}`;
    clav.position.set(0, SHOULDER_Y - 0.02, 0.005);
    chest.add(clav);
    const shoulder = new THREE.Bone();
    shoulder.name = `shoulder.${suffix}`;
    shoulder.position.set(side * BODY.shoulderX, 0.02, -0.005);
    clav.add(shoulder);
    const upper = new THREE.Bone();
    upper.name = `upperArm.${suffix}`;
    shoulder.add(upper);
    jointBall(clav, 0.028, side * 0.13, 0.006, -0.002);
    jointBall(shoulder, 0.03, 0, 0, 0);
    bone(upper, HUMERUS, 0.024);
    jointBall(upper, 0.02, 0, -HUMERUS, 0);

    const elbow = new THREE.Bone();
    elbow.name = `foreArm.${suffix}`;
    elbow.position.y = -HUMERUS;
    upper.add(elbow);
    bone(elbow, FOREARM, 0.017, -0.012);
    bone(elbow, FOREARM, 0.012, 0.014);
    jointBall(elbow, 0.018, 0, 0, 0);

    const hand = makeHand(side);
    hand.group.name = `hand.${suffix}`;
    hand.group.position.y = -FOREARM;
    elbow.add(hand.group);
    return { clav, shoulder, upper, elbow, hand };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // Epaulettes belong to the shoulder girdle, not the chest. Parented to the
  // clavicle they lie along the turned shoulder line and lift with the
  // scapulohumeral rhythm; on the chest they stayed put and stood up as pads
  // whenever the thorax rotated away from the arms.
  // Seated on the deltoid: the strap's top measures <=3 mm above the skinned
  // surface at its own footprint, so it reads as a sewn shoulder strap rather
  // than a pad hovering over the shoulder.
  add(armL.clav, rbox(0.086, 0.012, 0.05, 0.005), mats.tunicShade, [0.15, 0.046, 0.0], [0, 0, -0.24]);
  add(armR.clav, rbox(0.086, 0.012, 0.05, 0.005), mats.tunicShade, [-0.15, 0.046, 0.0], [0, 0, 0.24]);

  // ==================================================================== legs
  interface LegRig {
    hip: THREE.Bone;
    knee: THREE.Bone;
    ankle: THREE.Bone;
    toe: THREE.Bone;
  }

  const makeLeg = (side: 1 | -1): LegRig => {
    const suffix = side === 1 ? 'L' : 'R';
    const hip = new THREE.Bone();
    hip.name = `thigh.${suffix}`;
    hip.position.set(side * LEG.hipX, HIP, 0);
    body.add(hip);
    bone(hip, FEMUR, 0.027);
    add(hip, new THREE.SphereGeometry(0.032, 10, 8), mats.cartilage, [0, -FEMUR + 0.03, 0.035], undefined, 'bone');

    const knee = new THREE.Bone();
    knee.name = `shin.${suffix}`;
    knee.position.y = -FEMUR;
    hip.add(knee);
    bone(knee, TIBIA, 0.023);
    bone(knee, TIBIA * 0.92, 0.011, side * 0.024, 0.012);
    jointBall(knee, 0.026, 0, 0, 0);
    add(knee, new THREE.SphereGeometry(0.017, 8, 6), mats.bone, [0, -0.015, 0.045], undefined, 'bone');

    // The foot is two rigid parts joined at the MTP (ball) joint.
    const ankle = new THREE.Bone();
    ankle.name = `foot.${suffix}`;
    ankle.position.y = -TIBIA;
    knee.add(ankle);
    add(ankle, rbox(0.095, 0.042, 0.155, 0.018), mats.boots, [0, -0.042, -0.012]);
    add(ankle, rbox(0.085, 0.068, 0.085, 0.02), mats.boots, [0, -0.012, -0.028]);
    add(ankle, rbox(0.08, 0.024, 0.06, 0.01), mats.boots, [0, -0.052, -0.06]);
    add(ankle, rbox(0.072, 0.024, 0.11, 0.012), mats.bone, [0, 0.002, 0.02], undefined, 'bone');
    add(ankle, new THREE.SphereGeometry(0.018, 8, 6), mats.cartilage, [0, 0, -0.012], undefined, 'bone');
    jointBall(ankle, 0.019, 0, 0, 0);

    const toe = new THREE.Bone();
    toe.name = `toe.${suffix}`;
    toe.position.set(0, -0.045, 0.105);
    ankle.add(toe);
    add(toe, rbox(0.09, 0.036, 0.13, 0.014), mats.boots, [0, 0.002, 0.06]);
    add(toe, rbox(0.084, 0.03, 0.034, 0.01), mats.boots, [0, 0.004, 0.114]);
    add(toe, rbox(0.072, 0.016, 0.1, 0.006), mats.bone, [0, 0.014, 0.052], undefined, 'bone');
    for (let i = 0; i < 4; i += 1) {
      add(toe, new THREE.CapsuleGeometry(0.005, 0.028, 2, 5), mats.bone, [-0.024 + i * 0.016, 0.012, 0.122], [Math.PI / 2, 0, 0], 'bone');
    }
    return { hip, knee, ankle, toe };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // ============================================================== muscles
  // A muscle is a body between an origin and an insertion on two bones. Each
  // frame its real length is measured and the belly is scaled: shorter muscle,
  // fatter belly. These are the prime movers of the joints the rig animates.
  interface MuscleRig {
    def: MuscleDef;
    mesh: THREE.Mesh;
    a: THREE.Object3D;
    pa: THREE.Vector3;
    b: THREE.Object3D;
    pb: THREE.Vector3;
    radius: number;
    rest: number;
    activation: number;
  }
  const muscles: MuscleRig[] = [];

  // Room for a belly between the bone axis and the skin, by region. A belly is
  // fitted inside this envelope every frame: it hangs under the surface, it
  // does not sprout through it.
  const MUSCLE_ROOM: Record<MuscleDef['region'], number> = {
    hip: 0.096,
    thigh: 0.082,
    shank: 0.054,
    foot: 0.046,
    trunk: 0.1,
    shoulder: 0.071,
    arm: 0.046,
    neck: 0.054,
  };
  const axisA = new THREE.Vector3();
  const axisB = new THREE.Vector3();
  const boneHead = (obj: THREE.Object3D, out: THREE.Vector3) =>
    body.worldToLocal(obj.getWorldPosition(out));
  const muscleAxis = (def: MuscleDef, a: THREE.Vector3, b: THREE.Vector3) => {
    const leg = def.side === 'L' ? legL : legR;
    const arm = def.side === 'L' ? armL : armR;
    switch (def.region) {
      case 'thigh': boneHead(leg.hip, a); boneHead(leg.knee, b); break;
      case 'shank': boneHead(leg.knee, a); boneHead(leg.ankle, b); break;
      case 'foot': boneHead(leg.ankle, a); boneHead(leg.toe, b); break;
      case 'arm': boneHead(arm.upper, a); boneHead(arm.elbow, b); break;
      case 'shoulder': boneHead(chest, a); boneHead(arm.clav, b); break;
      case 'hip': boneHead(pelvis, a); boneHead(leg.hip, b); break;
      case 'neck': boneHead(neck, a); boneHead(head, b); break;
      default: boneHead(pelvis, a); boneHead(chest, b); break;
    }
  };
  // A belly, not a wire: a spindle that tapers into its tendons at both ends
  // and is fattest a little above the middle where the fibres bunch.
  const muscleGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.04, -1),
      new THREE.Vector2(0.18, -0.92),
      new THREE.Vector2(0.5, -0.6),
      new THREE.Vector2(0.85, -0.2),
      new THREE.Vector2(1, 0.05),
      new THREE.Vector2(0.86, 0.32),
      new THREE.Vector2(0.5, 0.66),
      new THREE.Vector2(0.18, 0.92),
      new THREE.Vector2(0.04, 1),
    ],
    10,
  );
  const addMuscle = (
    a: THREE.Object3D,
    pa: V3,
    b: THREE.Object3D,
    pb: V3,
    radius: number,
    def: MuscleDef,
  ) => {
    const mesh = add(body, muscleGeo, mats.muscle, [0, 0, 0], undefined, 'muscle');
    mesh.castShadow = false;
    mesh.userData.deep = !!def.deep;
    const rig: MuscleRig = {
      def,
      mesh,
      a,
      pa: new THREE.Vector3(...pa),
      b,
      pb: new THREE.Vector3(...pb),
      radius,
      rest: 0,
      activation: 0,
    };
    muscles.push(rig);
  };

  // =========================================================== uniform fit
  const beltMesh = add(
    pelvis,
    new THREE.CylinderGeometry(1, 1, 0.05, 24, 1, true),
    mats.belt,
    [0, 0.062, 0],
  );
  beltMesh.scale.set(0.153, 1, 0.109);
  add(pelvis, rbox(0.062, 0.042, 0.02, 0.006), mats.accent, [0, 0.062, 0.113]);
  if (fine) {
    // Brassard on the left upper arm, wrapped to the arm rather than floating
    // over the chest.
    const brassard = add(
      armL.upper,
      new THREE.CylinderGeometry(0.06, 0.06, 0.095, 18, 1, true),
      mats.brassard,
      [0, -0.085, 0],
    );
    brassard.scale.z = 0.91;
    // A 1 cm stand-off shell inside the shadow map only produced a hard black
    // polygon across the band, so it neither casts nor receives shadow.
    brassard.castShadow = false;
    brassard.receiveShadow = false;
  }

  // ============================================================== skin
  // The uniform is one continuous surface over the bones now. Bind in the rest
  // pose, before any movement has rotated a joint.
  const skinBones: Record<SkinBoneName, THREE.Bone> = {
    pelvis,
    spine,
    chest,
    neck,
    head,
    'clav.L': armL.clav,
    'upperArm.L': armL.upper,
    'foreArm.L': armL.elbow,
    'hand.L': armL.hand.group,
    'clav.R': armR.clav,
    'upperArm.R': armR.upper,
    'foreArm.R': armR.elbow,
    'hand.R': armR.hand.group,
    'thigh.L': legL.hip,
    'shin.L': legL.knee,
    'foot.L': legL.ankle,
    'toe.L': legL.toe,
    'thigh.R': legR.hip,
    'shin.R': legR.knee,
    'foot.R': legR.ankle,
    'toe.R': legR.toe,
  };
  group.updateMatrixWorld(true);
  const skin = buildSkin(
    skinBones,
    { tunic: mats.tunic, trousers: mats.trousers, skin: mats.skin },
    kit.detail,
  );
  for (const mesh of skin.meshes) {
    body.add(mesh);
    uniformMeshes.push(mesh);
  }

  // ============================================================== muscles
  // Attachments come from the muscle table in body space; convert each to its
  // bone's local space once, here, so the belly follows both bones afterwards.
  const boneFor = (side: Side, name: MuscleBone): THREE.Object3D => {
    switch (name) {
      case 'pelvis': return pelvis;
      case 'spine': return spine;
      case 'chest': return chest;
      case 'neck': return neck;
      case 'head': return head;
      case 'clav': return side === 'L' ? armL.clav : armR.clav;
      case 'upperArm': return side === 'L' ? armL.upper : armR.upper;
      case 'foreArm': return side === 'L' ? armL.elbow : armR.elbow;
      case 'hand': return side === 'L' ? armL.hand.group : armR.hand.group;
      case 'thigh': return side === 'L' ? legL.hip : legR.hip;
      case 'shin': return side === 'L' ? legL.knee : legR.knee;
      case 'foot': return side === 'L' ? legL.ankle : legR.ankle;
    }
  };

  group.updateMatrixWorld(true);
  for (const def of MUSCLES) {
    const originBone = boneFor(def.side, def.origin.bone);
    const insertBone = boneFor(def.side, def.insertion.bone);
    const pa = originBone.worldToLocal(new THREE.Vector3(...def.origin.at));
    const pb = insertBone.worldToLocal(new THREE.Vector3(...def.insertion.at));
    // A belly has volume: real quadriceps are seven or eight centimetres
    // across, not two. The table carries the fibre radius; the drawn belly is
    // that radius at full bulge.
    addMuscle(originBone, [pa.x, pa.y, pa.z], insertBone, [pb.x, pb.y, pb.z], def.radius * 1.15, def);
  }

  // ======================================================= rifle / colour
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  chest.add(weapon);
  add(weapon, rbox(0.054, 0.3, 0.08, 0.02), mats.rifleWood, [0, 0.15, 0]);
  add(weapon, rbox(0.052, 0.022, 0.082, 0.008), mats.rifleMetal, [0, 0.013, 0]);
  add(weapon, rbox(0.046, 0.14, 0.056, 0.018), mats.rifleWood, [0, 0.365, 0.004]);
  add(weapon, rbox(0.05, 0.15, 0.062, 0.012), mats.rifleMetal, [0, 0.46, 0.002]);
  add(weapon, rbox(0.042, 0.12, 0.05, 0.01), mats.rifleMetal, [0, 0.45, -0.052]);
  add(weapon, new THREE.TorusGeometry(0.024, 0.006, 5, 12), mats.rifleMetal, [0, 0.4, -0.044], [Math.PI / 2, 0, 0]);
  add(weapon, rbox(0.05, 0.5, 0.054, 0.018), mats.rifleWood, [0, 0.72, 0.002]);
  add(weapon, rbox(0.054, 0.07, 0.058, 0.012), mats.rifleMetal, [0, 0.94, 0]);
  add(weapon, new THREE.CylinderGeometry(0.011, 0.012, 0.19, 10), mats.rifleMetal, [0, 1.045, 0]);
  add(weapon, rbox(0.016, 0.02, 0.02, 0.004), mats.rifleMetal, [0, 1.1, 0.021]);
  add(weapon, new THREE.CylinderGeometry(0.014, 0.012, 0.022, 10), mats.rifleMetal, [0, 1.122, 0]);
  add(weapon, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), mats.rifleMetal, [-0.04, 0.47, 0], [0, 0, 1.15]);
  add(weapon, new THREE.SphereGeometry(0.014, 8, 6), mats.rifleMetal, [-0.086, 0.455, 0]);
  add(weapon, rbox(0.008, 0.42, 0.012, 0.003), mats.belt, [0, 0.34, -0.042]);

  const colour = new THREE.Group();
  colour.name = 'colour';
  chest.add(colour);
  add(colour, new THREE.CylinderGeometry(0.016, 0.018, PIKE.length, 10), mats.rifleWood, [0, PIKE.length / 2, 0]);
  add(colour, new THREE.CylinderGeometry(0.02, 0.016, 0.06, 10), mats.badge, [0, PIKE.length - 0.02, 0]);
  add(colour, new THREE.ConeGeometry(0.03, 0.13, 10), mats.badge, [0, PIKE.length + 0.05, 0]);
  add(colour, new THREE.SphereGeometry(0.028, 10, 8), mats.badge, [0, PIKE.length + 0.12, 0]);
  const flagGroup = new THREE.Group();
  flagGroup.position.set(0.02, PIKE.flagAt, 0);
  colour.add(flagGroup);
  const flagGeo = new THREE.PlaneGeometry(0.92, 0.6, 12, 8);
  const flagTexture = createFlagTexture();
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture, side: THREE.DoubleSide, roughness: 0.92 });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.x = 0.46;
  flag.castShadow = true;
  flagGroup.add(flag);
  const flagBase = Float32Array.from(flagGeo.attributes.position.array as Float32Array);

  // =============================================================== mode set
  let angles: JointReading[] = [];
  let mode: BodyMode = 'uniform';

  const applyMode = () => {
    // The muscle view keeps the body on screen as a ghost. Without it the
    // bellies look like loose spindles; through it, they read as anatomy under
    // the skin, and anything that pokes out is immediately visible.
    const showUniform = mode !== 'skeleton';
    uniformMeshes.forEach((m) => (m.visible = showUniform));
    skeletonMeshes.forEach((m) => (m.visible = mode !== 'uniform'));
    const muscleOn = (m: THREE.Object3D) => {
      m.visible = mode === 'muscles' && !(m.userData.deep as boolean | undefined);
    };
    muscleMeshes.forEach(muscleOn);
    const transparent = mode !== 'uniform';
    const alpha = mode === 'xray' ? 0.16 : mode === 'muscles' ? 0.16 : 1;
    // The tunic is dark navy; at 16% over a dark square it disappears. A faint
    // blue self-light keeps the ghost of the body readable so the muscles sit
    // inside a silhouette instead of floating in the dark.
    const ghostLift = mode === 'muscles';
    uniformMats.forEach((m) => {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = alpha;
      m.depthWrite = !transparent;
      if (m.emissive) {
        m.emissive.set(ghostLift ? '#24384c' : '#000000');
        m.emissiveIntensity = ghostLift ? 1 : 0;
      }
    });
  };
  applyMode();

  // =============================================================== state
  let blend = 0;
  let turnRate = 0;
  let turnTravel = 0;
  let heading = 0;
  let appliedHeading = 0;
  let hasHeading = false;
  let lastTime = 0;
  let firstAnim = true;
  // The thorax and head do not arrive with the pelvis: they settle a beat
  // later. A first-order lag is enough to give the turn and the step a
  // follow-through instead of a pose that snaps to its target.
  let chestLag = 0;
  let headLag = 0;
  let lagInit = false;
  let liveL: FootTarget = standTargets().left;
  let liveR: FootTarget = standTargets().right;
  let liveHipY = standTargets().hipY;
  let curlL = 0.2;
  let curlR = 0.2;
  let pose: FigurePose = {
    hipY: liveHipY,
    left: { ankle: [0, 0, 0], pitch: 0, toe: 0, yaw: 0, planted: true, knee: 0 },
    right: { ankle: [0, 0, 0], pitch: 0, toe: 0, yaw: 0, planted: true, knee: 0 },
    fingers: { left: curlL, right: curlR },
    turn: 0,
    walking: 0,
  };

  const socket = new THREE.Vector3();
  const femurDir = new THREE.Vector3();
  const footQuat = new THREE.Quaternion();
  const parentQuat = new THREE.Quaternion();

  const applyLeg = (leg: LegRig, foot: FootTarget, socketWorld: THREE.Vector3) => {
    const sol = solveKnee(
      [socketWorld.x, socketWorld.y, socketWorld.z],
      [foot.x, foot.y, foot.z],
      [0, 0, 1],
    );
    femurDir.set(sol.knee[0] - socketWorld.x, sol.knee[1] - socketWorld.y, sol.knee[2] - socketWorld.z);
    leg.hip.position.copy(socketWorld);
    leg.hip.quaternion.copy(limbQuat(femurDir));
    leg.knee.rotation.set(rad(sol.kneeFlexion), 0, 0);
    // Foot orientation is set in body space, not inherited from the shank, so
    // heel strike, foot flat and heel-off are exactly the angles the gait asks
    // for even when the shank is angled.
    footQuat.setFromEuler(new THREE.Euler(rad(foot.pitch), rad(foot.yaw), 0, 'YXZ'));
    parentQuat.copy(leg.hip.quaternion).multiply(leg.knee.quaternion);
    leg.ankle.quaternion.copy(parentQuat.invert().multiply(footQuat));
    leg.toe.rotation.x = -rad(foot.toe);
    return sol;
  };

  return {
    group,
    setTransform(x, z, headingNow) {
      group.position.set(x, 0, z);
      group.rotation.y = headingNow;
      heading = headingNow;
      if (!hasHeading) {
        appliedHeading = headingNow;
        hasHeading = true;
      }
    },
    setHeight(h) {
      group.scale.setScalar(h / 1.78);
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      applyMode();
    },
    getAngles() {
      return angles;
    },
    getCarriage() {
      const frameOf = (g: THREE.Group): Carriage | null => {
        if (!g.visible) return null;
        const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
        return {
          butt: [g.position.x, g.position.y, g.position.z],
          dir: [dir.x, dir.y, dir.z],
          hands: {},
        };
      };
      return { weapon: frameOf(weapon), colour: frameOf(colour) };
    },
    getPose() {
      return pose;
    },
    getMuscles() {
      return muscles
        .map((m) => ({ name: m.def.name, activation: m.activation, peak: m.def.peak }))
        .sort((a, b) => b.activation - a.activation);
    },
    animate(anim) {
      const dt = lastTime ? Math.min(0.12, Math.max(0, anim.time - lastTime)) : 1 / 60;
      lastTime = anim.time;
      const u = clamp01(anim.u);

      // --- heading: a turn is a lagged pivot, not an instant spin
      if (hasHeading && heading !== appliedHeading) {
        const delta = wrapAngle(heading - appliedHeading);
        appliedHeading = heading;
        turnTravel += delta;
        const rate = (delta / Math.max(dt, 1 / 120)) * (180 / Math.PI);
        turnRate += (rate - turnRate) * 0.4;
      } else {
        turnRate *= Math.exp(-dt * 5.5);
        if (Math.abs(turnRate) < 0.4) turnRate = 0;
        turnTravel *= Math.exp(-dt * 6);
        if (Math.abs(turnTravel) < 0.01) turnTravel = 0;
      }
      const commanded = anim.turn ? turnFootwork(anim.turn.plan, anim.turn.progress) : null;
      const freeTurn = turnPose(turnRate);
      const leads = commanded ?? freeTurn;
      // 0 at the start of a turn, 1 at 45° through a 90° turn, 0 again at the
      // end: the outside foot steps across and plants, the inside heel lifts
      // and comes down. A turn is a step, not a lift held for its duration.
      const turnStep = Math.sin(Math.PI * Math.min(1, Math.abs(turnTravel) / (Math.PI / 2)));

      // --- gait: settle between standing and walking instead of snapping
      const want = anim.gait === 'halt' ? 0 : 1;
      if (firstAnim) {
        blend = want;
        firstAnim = false;
      }
      blend += (want - blend) * Math.min(1, dt * 6);
      if (want === 0 && blend < 0.002) blend = 0;
      if (want === 1 && blend > 0.998) blend = 1;
      const stand = standTargets();
      // Every cadet steps on their own beat. The offset is a fraction of a
      // cycle, so the formation reads as people keeping time together, not as
      // one body cloned thirty times.
      const rawCycle = gaitCycle(anim.gait, anim.stride, anim.time);
      const cycle = (((rawCycle - (anim.code?.phase ?? 0)) % 1) + 1) % 1;
      const live = gaitTargets(anim.gait, cycle);
      const g: GaitTargets = blendTargets(stand, live, blend);
      const turnWeight = 1 - blend * 0.6;

      // foot overlays for the pivot
      let footL: FootTarget = { ...g.left };
      let footR: FootTarget = { ...g.right };
      if (commanded) {
        // The command supplies the exact foot: heel/toe pivot, close, check
        // and step. No generic step-around is layered on top of it.
        footL.pitch += commanded.left.pitch;
        footL.y += commanded.left.lift;
        footL.yaw += commanded.left.yaw;
        footL.planted = commanded.left.planted;
        footL.contact = commanded.left.contact;
        footR.pitch += commanded.right.pitch;
        footR.y += commanded.right.lift;
        footR.yaw += commanded.right.yaw;
        footR.planted = commanded.right.planted;
        footR.contact = commanded.right.contact;
      } else if (freeTurn.magnitude > 0.01 && turnStep > 0.001) {
        const heel = freeTurn.insideHeel * turnStep * turnWeight;
        const pivot = freeTurn.inside === 'L' ? footL : footR;
        const step = freeTurn.inside === 'L' ? footR : footL;
        pivot.pitch += heel;
        pivot.y += LEG.ballLever * Math.sin(rad(heel));
        pivot.yaw += freeTurn.insideYaw * turnStep * turnWeight;
        step.y += freeTurn.outsideLift * turnStep * turnWeight;
        step.z += 0.05 * turnStep * turnWeight;
        step.yaw += freeTurn.outsideYaw * turnStep * turnWeight;
        if (turnStep > 0.2) step.planted = false;
      }
      if (anim.feet) {
        // A step plan has already decided where each foot is and when it is
        // down. Nothing from the gait may overwrite that: a planted foot is a
        // world constraint, not a pose suggestion.
        footL = { ...anim.feet.left };
        footR = { ...anim.feet.right };
      }
      liveL = footL;
      liveR = footR;
      // A heel or ball raise lifts the ankle, and the body must rise with it or
      // the knee absorbs the whole lift. That is what made a braced pivot look
      // like a high step: a 1.5 cm ankle lift became a 32-degree knee bend on a
      // nearly straight leg. Rising by the average planted-foot lift keeps both
      // stance legs close to extension while the pivot foot carries the body.
      const plantedFeet = commanded
        ? [commanded.left, commanded.right].filter((foot) => foot.planted)
        : [];
      const stanceRise = plantedFeet.length
        ? plantedFeet.reduce((sum, foot) => sum + foot.lift, 0) / plantedFeet.length
        : 0;
      liveHipY = anim.feet ? anim.feet.hipY : g.hipY + stanceRise;

      // --- posture, blended across the movement
      const fromSpine = DRILL_SPINE[anim.from.posture] ?? DRILL_SPINE.attention;
      const toSpine = DRILL_SPINE[anim.to.posture] ?? DRILL_SPINE.attention;
      const spLumbar = lerp(fromSpine.lumbar, toSpine.lumbar, u);
      const spThoracic = lerp(fromSpine.thoracic, toSpine.thoracic, u);
      const spCervical = lerp(fromSpine.cervical, toSpine.cervical, u);
      const lean = clampJoint('lumbarFlexion', g.lean) * blend;
      const pelvisYaw = -g.yaw * blend + leads.pelvisYaw * turnWeight;
      const list = g.list * blend + leads.list * turnWeight;
      const eyes = anim.eyes;
      // The directing flank (the right marker) keeps head and eyes front on an
      // eyes-right; everyone else turns the neck, not the shoulders.
      const headFollow = anim.code?.headFollow ?? 1;
      // The commander orders a right dress and watches it; he is not dressing
      // with the ranks, so his head stays front even though the squad looks right.
      const eyesFactor =
        anim.dressing && anim.role === 'commander' ? 0 : clamp01(anim.eyesAmount ?? 1);
      const cervical =
        (eyes === 'right' ? -EYES_RIGHT.cervical : eyes === 'left' ? EYES_RIGHT.cervical : 0) *
        headFollow *
        eyesFactor;
      // On an eyes-right the person in command salutes, and EYES FRONT cuts
      // that salute. The engine counts the weight so the arm rises and falls
      // through the movement instead of snapping between two frames. Right
      // dress is not a salute: the commander orders the dressing and then EYES
      // FRONT (A-DH-201-000 Ch 7), so the arm stays down while the squad looks
      // right.
      const commanderSalute =
        anim.role === 'commander' && !anim.dressing && !hasRifle && !hasColour
          ? clamp01(anim.commanderSalute ?? 0)
          : 0;
      const armScale = anim.code?.armSwing ?? 1;
      const lagRate = 1 - Math.exp(-Math.max(0.004, dt) * 13);
      const chestTarget = g.yaw * 1.05 * blend + leads.chestYaw * turnWeight;
      // A head does not ride the shoulders: the neck counter-rotates most of
      // the pelvic yaw so the gaze stays level and to the front. That
      // stabilisation is what reads as "eyes steady" on parade.
      const headTarget = cervical * 0.45 - g.yaw * 0.5 + leads.headYaw * 0.45 * turnWeight;
      if (!lagInit) {
        chestLag = chestTarget;
        headLag = headTarget;
        lagInit = true;
      }
      chestLag += (chestTarget - chestLag) * lagRate;
      headLag += (headTarget - headLag) * lagRate;

      pelvis.rotation.set(
        rad(clampJoint('lumbarFlexion', lean * 0.35 + spLumbar * 0.3 + leads.lean * 0.2)),
        rad(pelvisYaw),
        rad(list),
      );
      // A pelvis lists over the hip that is carrying the weight. Rotating it
      // about its own centre would lift the stance socket and pull that foot
      // off the ground, so drop the centre by however much the list raised it.
      const riseL = footL.planted
        ? new THREE.Vector3(LEG.hipX, 0, 0).applyQuaternion(pelvis.quaternion).y
        : 0;
      const riseR = footR.planted
        ? new THREE.Vector3(-LEG.hipX, 0, 0).applyQuaternion(pelvis.quaternion).y
        : 0;
      const listRise = Math.max(0, riseL, riseR);
      pelvis.position.set(g.sway * blend + leads.shift * turnWeight, liveHipY - listRise, 0);
      spine.rotation.set(
        rad(clampJoint('lumbarFlexion', lean * 0.35 + spLumbar * 0.4)),
        rad(-pelvisYaw * 0.15),
        rad(-list * 0.15),
      );
      // The thorax counter-rotates against the pelvis in the step, but in a
      // turn it leads: a body turns its shoulders before its hips.
      chest.rotation.set(
        rad(lean * 0.2 + spThoracic * 0.3),
        rad(chestLag),
        rad(-list * 0.3),
      );

      // --- head: eyes are cervical rotation; the head stabilises the gaze, so
      // it lags the chest and takes out part of the pelvic list.
      neck.rotation.set(
        rad(spCervical * 0.45),
        rad(cervical * 0.55 + leads.headYaw * 0.55 * turnWeight),
        rad(-list * 0.12),
      );
      head.rotation.set(
        rad(spCervical * 0.35),
        rad(headLag),
        rad(-list * 0.1),
      );
      beret.visible = anim.headdress === 'worn';

      // --- rifle and colour, then hands on their grips
      const a = poseTargets(anim.from, hasRifle, hasColour);
      const b = poseTargets(anim.to, hasRifle, hasColour);
      if (anim.dressing && !hasColour) {
        // Right dress is counted. ONE is the check pace with the arm at the
        // side; TWO raises the arm while the head turns; THREE is the short
        // quick paces with the arm still up. A single linear blend had the arm
        // already half-raised during the check pace, which is not the manual.
        const dressT = clamp01(anim.dressT ?? 1);
        const raise = clamp01((dressT - 0.2) / 0.18);
        // The current front rank raises an arm except the right-hand person,
        // who stands fast; the centre and rear ranks do not raise arms. With a
        // rifle the right hand keeps it at the order and the free LEFT arm
        // dresses; without arms the right arm dresses.
        const raises = anim.dressArm ?? false;
        if (hasRifle) {
          const target = raises
            ? lerpV(POSTURE_HANDS.attention.left, DRESS_LEFT_RAISED, raise)
            : POSTURE_HANDS.attention.left;
          a.handL = target;
          b.handL = target;
        } else {
          a.handL = DRESS_HANDS.left;
          b.handL = DRESS_HANDS.left;
          if (raises) {
            const target = lerpV(POSTURE_HANDS.attention.right, DRESS_HANDS.right, raise);
            a.handR = target;
            b.handR = target;
          }
        }
      }
      // EYES FRONT after a right dress cuts the arm; it is not already down at
      // the start of the movement, which is what a snapshot-to-snapshot blend
      // would produce.
      if (anim.armFromDress !== undefined && !hasColour) {
        const hold = clamp01(anim.armFromDress);
        if (hasRifle) {
          const target = lerpV(POSTURE_HANDS.attention.left, DRESS_LEFT_RAISED, hold);
          a.handL = target;
          b.handL = target;
        } else {
          const target = lerpV(POSTURE_HANDS.attention.right, DRESS_HANDS.right, hold);
          a.handR = target;
          b.handR = target;
        }
      }
      let weaponFrame = mixCarriage(a.weapon, b.weapon, u);
      const colourFrame = mixCarriage(a.colour, b.colour, u);
      // A rifle movement has numbered carriage frames, not one blend: the
      // sampled frame is the authority for the rifle and the count targets.
      if (anim.rifle && hasRifle) weaponFrame = anim.rifle.carriage;
      weapon.visible = !!weaponFrame && hasRifle;
      colour.visible = !!colourFrame && hasColour;
      if (weaponFrame) placeCarriage(weapon, weaponFrame);
      if (colourFrame) placeCarriage(colour, colourFrame);
      const carrier = weaponFrame ?? colourFrame;

      let gripL = (handIsGripping(a, 'L') ? 1 - u : 0) + (handIsGripping(b, 'L') ? u : 0);
      let gripR = (handIsGripping(a, 'R') ? 1 - u : 0) + (handIsGripping(b, 'R') ? u : 0);

      let handL: V3 = [
        lerp(a.handL[0], b.handL[0], u),
        lerp(a.handL[1], b.handL[1], u),
        lerp(a.handL[2], b.handL[2], u),
      ];
      let handR: V3 = [
        lerp(a.handR[0], b.handR[0], u),
        lerp(a.handR[1], b.handR[1], u),
        lerp(a.handR[2], b.handR[2], u),
      ];
      if (anim.rifle && hasRifle) {
        handL = anim.rifle.handL;
        handR = anim.rifle.handR;
        gripL = anim.rifle.gripL;
        gripR = anim.rifle.gripR;
      }
      if (blend > 0.01) {
        // On a marching turn the manual cuts both arms to the sides through
        // the pivot; they pick the swing up again on the step-out.
        const armCut = Math.max(commanded?.armCut ?? 0, anim.armCut ?? 0);
        const swing = 1 - armCut * 0.9;
        // A step plan owns the boots, so the arms must swing from where it
        // actually put them. The free-running gait cycle can be at the opposite
        // phase from the planned feet, which swung each arm forward with the
        // leg on its own side: the bear march. Each arm opposes its own foot,
        // so both sides take the same sign of that foot's forward offset.
        const amplitude = GAIT_SPEC[anim.gait].armSwing;
        const swingFrom = (z: number) =>
          -amplitude * Math.max(-1, Math.min(1, z / PACE_HALF));
        const swingL = anim.feet ? swingFrom(anim.feet.left.z) : g.armL;
        const swingR = anim.feet ? swingFrom(anim.feet.right.z) : g.armR;
        if (gripL < 0.5) handL = swingHand(handL, swingL * armScale * blend * swing, Math.max(4, g.elbowL));
        if (gripR < 0.5) handR = swingHand(handR, swingR * armScale * blend * swing, Math.max(4, g.elbowR));
      }
      // SALUTE. Without arms the hand goes to the headdress (Ch 2, paras
      // 37-38). With a rifle it is a different movement: the right arm crosses
      // the body and the hand strikes the small of the butt, back of the hand
      // up (54-04 para 90). The hand is placed after the swing so the marching
      // swing cannot drag it down, and the arm factor carries the movement
      // through ONE, the standard pause and TWO's cut away.
      const saluteFromPosture =
        (anim.from.posture === 'salute' ? 1 - u : 0) + (anim.to.posture === 'salute' ? u : 0);
      const saluteArm =
        gripR < 0.5
          ? Math.max(saluteFromPosture, clamp01(anim.saluteArm ?? 0), commanderSalute)
          : 0;
      const rifleSalute = saluteArm > 0 && hasRifle && weaponFrame !== null;
      if (saluteArm > 0) {
        const saluteTarget = rifleSalute
          ? armedSaluteHand(weaponFrame!)
          : POSTURE_HANDS.salute.right;
        handR = lerpV(POSTURE_HANDS.attention.right, saluteTarget, saluteArm);
        if (rifleSalute) {
          // The armed salute crosses the body in front of the tunic. A straight
          // blend from the side would take the hand through the abdomen, so
          // the transit bows forward and is square on the butt at the hold.
          handR[2] += Math.sin(Math.PI * saluteArm) * 0.12;
        }
      }

      const armAxisL = carrier ? new THREE.Vector3(...carrier.dir).normalize() : new THREE.Vector3(0, 1, 0);
      const armAxisR = armAxisL.clone();

      const runArm = (
        arm: ArmRig,
        target: V3,
        side: 1 | -1,
        grip: number,
        bar: THREE.Vector3,
        /** Right dress: hand closed as at attention, back of the hand up. */
        dressHand = false,
        /** 0..1 salute: the unarmed hand is at the headdress. */
        salute = 0,
        /** This salute is given with a rifle: the forearm is level. */
        saluteArmed = false,
        /** This grip is carried with the forearm parallel to the ground. */
        levelGrip = false,
      ) => {
        // The wrist sits a palm's thickness out from the rifle, so the palm
        // touches the bar and the fingers can close around it.
        const out = new THREE.Vector3(side, 0, 0);
        out.addScaledVector(bar, -out.dot(bar));
        if (out.lengthSq() < 1e-5) out.set(0, 0, 1).addScaledVector(bar, -bar.z);
        out.normalize();
        const wrist: V3 = grip > 0.5
          ? [target[0] + out.x * 0.03, target[1] + out.y * 0.03, target[2] + out.z * 0.03]
          : target;
        // Scapulohumeral rhythm: the shoulder girdle rotates about one degree
        // for every two of arm elevation, and protracts when the hand reaches
        // across the body. The socket lifts before the arm is asked to reach,
        // which is why a real high grip does not look strained at the shoulder.
        const restShoulder = new THREE.Vector3(side * BODY.shoulderX, SHOULDER_Y, 0);
        const horizontal = Math.max(0.02, Math.hypot(target[0] - restShoulder.x, target[2]));
        const elevation = (Math.atan2(target[1] - restShoulder.y, horizontal) * 180) / Math.PI;
        const upward = Math.max(0, Math.min(20, (elevation - 12) / 3.2));
        const across = Math.max(0, Math.min(9, (Math.abs(restShoulder.x) - side * target[0]) * 45));
        arm.clav.rotation.set(0, rad(-side * across), rad(side * upward));
        const S = new THREE.Vector3(side * BODY.shoulderX, 0.02, -0.005)
          .applyQuaternion(arm.clav.quaternion)
          .add(arm.clav.position);
        const T = new THREE.Vector3(wrist[0], wrist[1], wrist[2]);
        const dir = T.clone().sub(S);
        const rawDist = dir.length();
        const dist = Math.max(0.08, Math.min(ARM_MAX_REACH - 0.003, rawDist));
        dir.normalize();
        const along = (HUMERUS * HUMERUS - FOREARM * FOREARM + dist * dist) / (2 * dist);
        const height = Math.sqrt(Math.max(0.0002, HUMERUS * HUMERUS - along * along));
        const base = S.clone().addScaledVector(dir, along);
        // Where the elbow goes is pure anatomy. With the hand below the
        // shoulder the upper arm hangs and the forearm rises in front, so the
        // elbow sits behind the arm line. With the hand raised the elbow swings
        // out and down. A single fixed pole gets one of those wrong.
        const low = clamp01((S.y - target[1]) / 0.35);
        const pole = new THREE.Vector3(
          side * (0.65 - 0.4 * low),
          -0.75 + 0.7 * low,
          -0.2 - 0.77 * low,
        );
        pole.addScaledVector(dir, -pole.dot(dir));
        if (pole.lengthSq() < 1e-6) pole.set(0, 0, -1);
        pole.normalize();
        const elbowPos = base.clone().addScaledVector(pole, height);
        // SALUTE: the manual puts the upper arm parallel to the ground. The
        // generic pole throws the elbow above the shoulder for a hand that
        // high, so solve the elbow on the horizon through the shoulder and
        // bring it in as the hand comes up.
        if (salute > 0.001) {
          const solve = saluteArmed ? levelForearmElbow : levelElbow;
          const level = solve([S.x, S.y, S.z], [target[0], target[1], target[2]]);
          if (level) elbowPos.lerp(new THREE.Vector3(level[0], level[1], level[2]), salute);
        }
        // RIFLE GRIP: the slope holds the left forearm parallel to the ground
        // (54-04 para 27). The generic swing pole hangs the elbow under a hand
        // that low and tips the forearm about nine degrees, so solve the elbow
        // on the horizon through the wrist and keep it clear of the ribs.
        if (levelGrip) {
          const level = rifleGripElbow([S.x, S.y, S.z], [wrist[0], wrist[1], wrist[2]]);
          if (level) {
            const w = clamp01((grip - 0.15) / 0.7);
            elbowPos.lerp(new THREE.Vector3(level[0], level[1], level[2]), w);
          }
        }
        const upperDir = elbowPos.clone().sub(S).normalize();
        const wristPos = S.clone().addScaledVector(dir, dist);
        const foreDir = wristPos.clone().sub(elbowPos).normalize();

        // The IK above is solved in chest space; the arm hangs off the
        // clavicle, so take the clavicle's rotation out before storing a local
        // rotation on the humerus.
        arm.upper.quaternion.copy(arm.clav.quaternion).invert().multiply(limbQuat(upperDir));
        const foreQuat = limbQuat(foreDir);
        const chain = arm.clav.quaternion.clone().multiply(arm.upper.quaternion);
        arm.elbow.quaternion.copy(chain.invert().multiply(foreQuat));

        // palm faces the bar: local +Z is the back of the hand
        let desired: THREE.Quaternion;
        if (grip > 0.5) {
          desired = frameQuat(bar.clone().negate(), out);
        } else if (dressHand || salute > 0.15) {
          // Back of the hand up: the palm faces the ground and the fingers
          // point along the raised forearm, which is a flat dressing hand or
          // the manual's salute rather than a relaxed palm to the thigh.
          desired = frameQuat(foreDir.clone().negate(), UP);
        } else {
          const dorsal = new THREE.Vector3(side, 0, 0).addScaledVector(foreDir, -side * foreDir.x);
          if (dorsal.lengthSq() < 1e-5) dorsal.set(0, 0, 1);
          dorsal.normalize();
          desired = frameQuat(foreDir.clone().negate(), dorsal);
        }
        parentQuat
          .copy(arm.clav.quaternion)
          .multiply(arm.upper.quaternion)
          .multiply(arm.elbow.quaternion);
        arm.hand.group.quaternion.copy(parentQuat.clone().invert().multiply(desired));
        // A dressing hand is closed as in the position of attention; only the
        // wrist turns the back of it uppermost. A flat open hand is a different
        // drill movement, not this one.
        // The salute's thumb and fingers are fully extended and close together.
        const curl = grip > 0.5 ? 0.92 : 0.2 - 0.18 * salute;
        setHandCurl(arm.hand, curl);
        return { upperDir, foreDir, curl };
      };

      // The dressing hand is flat and palm-down only while the arm is raised;
      // at the side on ONE it is an ordinary relaxed hand.
      const dressUp = anim.dressing
        ? clamp01((clamp01(anim.dressT ?? 1) - 0.2) / 0.18)
        : clamp01(anim.armFromDress ?? 0);
      const dressArm = (anim.dressing || anim.armFromDress !== undefined) && !hasColour;
      const dressRaised = dressArm && (anim.dressArm ?? false) && dressUp > 0.15;
      const leftDressHand = dressRaised && hasRifle;
      const rightDressHand = dressRaised && !hasRifle;
      // The manual levels the left forearm wherever the rifle is carried on the
      // shoulder or in front of it (slope and present arms), so the elbow is
      // solved rather than left to the generic swing pole.
      const levelLeftGrip =
        weaponFrame !== null &&
        gripL > 0.15 &&
        (anim.to.weapon === 'slope' || anim.to.weapon === 'present');
      const leftArm = runArm(
        armL,
        handL,
        1,
        gripL,
        armAxisL,
        leftDressHand,
        0,
        false,
        levelLeftGrip,
      );
      const rightArm = runArm(
        armR,
        handR,
        -1,
        gripR,
        armAxisR,
        rightDressHand,
        saluteArm,
        rifleSalute,
      );
      curlL = leftArm.curl;
      curlR = rightArm.curl;

      // --- legs: sockets from the real pelvis, feet from the gait
      pelvis.updateMatrix();
      const socketL = socket.set(LEG.hipX, 0, 0).applyQuaternion(pelvis.quaternion).add(pelvis.position).clone();
      const socketR = socket.set(-LEG.hipX, 0, 0).applyQuaternion(pelvis.quaternion).add(pelvis.position).clone();
      const solL = applyLeg(legL, footL, socketL);
      const solR = applyLeg(legR, footR, socketR);

      // --- muscle lengths
      if (mode === 'muscles') {
        body.updateMatrixWorld(true);
        for (const m of muscles) {
          if (m.def.deep) continue;
          const pa = m.a.localToWorld(m.pa.clone());
          const pb = m.b.localToWorld(m.pb.clone());
          body.worldToLocal(pa);
          body.worldToLocal(pb);
          const dist = pa.distanceTo(pb);
          if (!m.rest) m.rest = Math.max(0.02, dist);
          const ratio = clamp01(1 - dist / m.rest);
          // Two things make a belly: it shortens (so it thickens) and it is
          // switched on. A working muscle is visibly rounder than a slack one.
          m.activation = muscleActivationFor(
            m.def,
            anim.gait,
            cycle + (m.def.side === 'R' ? 0.5 : 0),
          );
          const bulge = 1 + ratio * 0.34 + m.activation * 0.14;
          const radius = m.radius * bulge;
          // Fit the belly under the skin. The anchors are palpable landmarks on
          // the surface, so a spindle centred on their midpoint sticks out of
          // the limb; sliding it in toward the bone axis puts it back under the
          // skin without detaching the tendons from their bones.
          const mid = pa.clone().add(pb).multiplyScalar(0.5);
          muscleAxis(m.def, axisA, axisB);
          const seg = axisB.clone().sub(axisA);
          const span = Math.max(1e-6, seg.lengthSq());
          const along = clamp01(mid.clone().sub(axisA).dot(seg) / span);
          const onAxis = axisA.clone().addScaledVector(seg, along);
          const radial = mid.clone().sub(onAxis);
          const reach = radial.length();
          const room = MUSCLE_ROOM[m.def.region] - 0.003;
          if (reach > 1e-5 && reach + radius > room) {
            radial.multiplyScalar(Math.max(0, room - radius) / reach);
            m.mesh.position.copy(onAxis).add(radial);
          } else {
            m.mesh.position.copy(mid);
          }
          const dir = pb.clone().sub(pa).normalize();
          m.mesh.quaternion.setFromUnitVectors(UP, dir);
          m.mesh.scale.set(radius, Math.max(0.01, dist / 2), radius);
        }
      }

      // --- readings from the joints that actually resulted
      const limb = (v: THREE.Vector3, mirror: 1 | -1) => {
        const len = v.length() || 1;
        const elevation = Math.acos(Math.max(-1, Math.min(1, -v.y / len)));
        const azimuth = Math.atan2((v.x / len) * mirror, v.z / len);
        return {
          flexion: deg(elevation * Math.cos(azimuth)),
          abduction: deg(elevation * Math.sin(azimuth)),
        };
      };
      // Chest-space humerus directions from the IK, so the shoulder readings
      // stay right when the clavicle has rotated.
      const upperL = leftArm.upperDir.clone();
      const upperR = rightArm.upperDir.clone();
      const armLimb = limb(upperL, 1);
      const armRLimb = limb(upperR, -1);
      const elbowL = deg(Math.acos(Math.max(-1, Math.min(1, upperL.dot(leftArm.foreDir)))));
      const elbowR = deg(Math.acos(Math.max(-1, Math.min(1, upperR.dot(rightArm.foreDir)))));

      angles = [
        reading('hipFlexion', solL.hipFlexion, 'L'),
        reading('hipFlexion', solR.hipFlexion, 'R'),
        reading('kneeFlexion', solL.kneeFlexion, 'L'),
        reading('kneeFlexion', solR.kneeFlexion, 'R'),
        reading('anklePlantar', footL.pitch, 'L'),
        reading('anklePlantar', footR.pitch, 'R'),
        reading('shoulderFlexion', armLimb.flexion, 'L'),
        reading('shoulderFlexion', armRLimb.flexion, 'R'),
        reading('shoulderAbduction', armLimb.abduction, 'L'),
        reading('shoulderAbduction', armRLimb.abduction, 'R'),
        reading('elbowFlexion', elbowL, 'L'),
        reading('elbowFlexion', elbowR, 'R'),
        reading('cervicalRotation', deg(neck.rotation.y + head.rotation.y)),
        reading('thoracicRotation', deg(spine.rotation.y + chest.rotation.y)),
        reading('lumbarFlexion', deg(pelvis.rotation.x + spine.rotation.x)),
        reading('pelvicTilt', deg(pelvis.rotation.z)),
        reading('toeExtension', footL.toe, 'L'),
        reading('toeExtension', footR.toe, 'R'),
      ];

      pose = {
        hipY: pelvis.position.y,
        left: {
          ankle: [footL.x, footL.y, footL.z],
          pitch: footL.pitch,
          toe: footL.toe,
          yaw: footL.yaw,
          planted: footL.planted,
          knee: solL.kneeFlexion,
        },
        right: {
          ankle: [footR.x, footR.y, footR.z],
          pitch: footR.pitch,
          toe: footR.toe,
          yaw: footR.yaw,
          planted: footR.planted,
          knee: solR.kneeFlexion,
        },
        fingers: { left: curlL, right: curlR },
        turn: turnRate,
        turnPhase: commanded?.phase,
        pivot: anim.turn?.plan.pivot,
        walking: blend,
      };
    },
    tick(_dt, time) {
      if (!flag.visible) return;
      const pos = flagGeo.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = flagBase[i];
        const y = flagBase[i + 1];
        const amp = (x + 0.46) / 0.92;
        arr[i + 2] = Math.sin(time * 4 + x * 5 + y * 3) * 0.05 * amp;
      }
      pos.needsUpdate = true;
    },
    dispose() {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      allMats.forEach((m) => m.dispose());
      skin.skeleton.dispose();
      flagMat.dispose();
      flagTexture?.dispose();
    },
  };
}

function createFlagTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#c8102e';
  ctx.fillRect(0, 0, 128, 320);
  ctx.fillRect(384, 0, 128, 320);
  ctx.beginPath();
  const cx = 256;
  const cy = 158;
  const pts: [number, number][] = [
    [0, -92], [22, -40], [58, -58], [46, -18], [86, -8], [58, 26], [72, 58], [20, 46], [14, 88],
    [0, 62], [-14, 88], [-20, 46], [-72, 58], [-58, 26], [-86, -8], [-46, -18], [-58, -58], [-22, -40],
  ];
  ctx.moveTo(cx + pts[0][0], cy + pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(cx + x, cy + y);
  ctx.closePath();
  ctx.fillStyle = '#c8102e';
  ctx.fill();
  ctx.fillRect(252, cy + 84, 8, 44);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
