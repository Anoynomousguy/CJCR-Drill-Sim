import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  EYES_RIGHT,
  GAIT_ANATOMY,
  reading,
  clampJoint,
  DRILL_SPINE,
  type BodyMode,
  type JointReading,
} from '../engine/anatomy';
import type { ColourState, Posture, Snapshot, WeaponState } from '../engine/types';

/** Pose targets are in torso space: origin at the hips, +Y up, +Z forward. */
type V3 = [number, number, number];
type Rot = [number, number, number];

interface PoseTargets {
  handL: V3;
  handR: V3;
  torso: Rot;
  head: Rot;
  weapon: Rot | null;
  colour: Rot | null;
}

const WEAPON_HANDS: Record<WeaponState, { left?: V3; right: V3; rot: Rot }> = {
  none: { right: [-0.24, -0.1, 0.02], rot: [0, 0, 0] },
  order: { right: [-0.245, -0.16, 0.07], rot: [0, 0, 4] },
  slope: { right: [-0.225, -0.04, 0.03], left: [0.02, 0.21, 0.19], rot: [6, 0, 30] },
  present: { right: [-0.07, -0.02, 0.31], left: [0.07, 0.15, 0.33], rot: [0, 0, 0] },
  port: { right: [-0.16, 0.0, 0.25], left: [0.02, 0.18, 0.28], rot: [-22, 0, 32] },
  inspection: { right: [-0.16, 0.0, 0.25], left: [0.02, 0.18, 0.28], rot: [-22, 0, 26] },
  trail: { right: [-0.245, -0.12, 0.11], rot: [62, 0, 6] },
  grounded: { right: [-0.245, -0.1, 0.06], rot: [0, 0, 0] },
  reversed: { right: [-0.2, -0.02, 0.15], left: [-0.13, 0.02, 0.19], rot: [180, 0, 4] },
  sling: { right: [-0.2, 0.02, 0.11], rot: [150, 0, 26] },
};

const COLOUR_HANDS: Record<ColourState, { left?: V3; right: V3; rot: Rot }> = {
  none: { right: [-0.24, -0.1, 0.02], rot: [0, 0, 0] },
  order: { right: [-0.22, -0.06, 0.1], rot: [2, 0, 3] },
  carry: { right: [-0.1, 0.12, 0.25], left: [-0.01, -0.02, 0.21], rot: [0, 0, 0] },
  slope: { right: [-0.22, -0.02, 0.04], left: [-0.02, 0.2, 0.19], rot: [10, 0, 40] },
  dip: { right: [-0.06, 0.12, 0.33], left: [-0.12, 0.0, 0.29], rot: [72, 0, 10] },
  letFly: { right: [-0.16, 0.14, 0.21], left: [-0.02, 0.02, 0.17], rot: [12, 0, 34] },
};

const POSTURE_HANDS: Record<Posture, { left: V3; right: V3; torso?: Rot }> = {
  attention: { left: [0.235, -0.1, 0.02], right: [-0.235, -0.1, 0.02] },
  standAtEase: { left: [0.06, -0.03, -0.18], right: [-0.06, -0.03, -0.18] },
  standEasy: { left: [0.1, -0.06, -0.16], right: [-0.1, -0.06, -0.16], torso: [2, 0, 0] },
  salute: { left: [0.235, -0.1, 0.02], right: [-0.105, 0.585, 0.17] },
};

function targetsFor(snapshot: Snapshot, hasRifle: boolean, hasColour: boolean): PoseTargets {
  const posture = POSTURE_HANDS[snapshot.posture] ?? POSTURE_HANDS.attention;
  const base: PoseTargets = {
    handL: posture.left,
    handR: posture.right,
    torso: posture.torso ?? [0, 0, 0],
    head: [0, 0, 0],
    weapon: null,
    colour: null,
  };
  if (hasColour && snapshot.colour !== 'none') {
    const c = COLOUR_HANDS[snapshot.colour];
    base.handR = c.right;
    if (c.left) base.handL = c.left;
    base.colour = c.rot;
    if (snapshot.posture === 'salute') base.handR = posture.right;
    return base;
  }
  if (hasRifle && snapshot.weapon !== 'none') {
    const w = WEAPON_HANDS[snapshot.weapon];
    base.handR = w.right;
    if (w.left) base.handL = w.left;
    base.weapon = w.rot;
    if (snapshot.posture === 'salute' && snapshot.weapon === 'slope') base.handR = posture.right;
    return base;
  }
  return base;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (v: number) => (v * 180) / Math.PI;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const SKIN = '#c79a72';

/** Skeletal landmarks for a 1.78 m body. */
const HIP = 0.92;
const SPINE_Y = 0.07;
const CHEST_Y = 0.17; // relative to spine → 1.16 m
const SHOULDER_Y = 0.24; // relative to chest → 1.40 m
const NECK_Y = 0.31;
const HEAD_Y = 0.06;
const FEMUR = 0.45;
const TIBIA = 0.42;
const HUMERUS = 0.27;
const FOREARM = 0.245;

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
}

export interface Figure {
  group: THREE.Group;
  setTransform: (x: number, z: number, heading: number) => void;
  setHeight: (h: number) => void;
  setMode: (mode: BodyMode) => void;
  getAngles: () => JointReading[];
  animate: (anim: FigureAnim) => void;
  tick: (dt: number, time: number) => void;
  dispose: () => void;
}

const DOWN = new THREE.Vector3(0, -1, 0);

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
    muscle: mat('#a8443a', 0.78),
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

  // ================================================================ skeleton
  const bone = (parent: THREE.Object3D, length: number, radius: number, x = 0, z = 0, material = mats.bone) => {
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.008, length - radius * 2), 4, 9);
    return add(parent, geo, material, [x, -length / 2, z], undefined, 'bone');
  };
  const jointBall = (parent: THREE.Object3D, radius: number, x: number, y: number, z: number) =>
    add(parent, new THREE.SphereGeometry(radius, fine ? 14 : 8, fine ? 10 : 6), mats.cartilage, [x, y, z], undefined, 'bone');
  const muscle = (
    parent: THREE.Object3D,
    radius: number,
    length: number,
    x: number,
    y: number,
    z: number,
    scale: V3 = [1, 1, 1],
  ) => {
    const geo = new THREE.CapsuleGeometry(radius, length, 4, 10);
    const mesh = add(parent, geo, mats.muscle, [x, y, z], undefined, 'muscle');
    mesh.scale.set(scale[0], scale[1], scale[2]);
    return mesh;
  };

  // =============================================================== hierarchy
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP;
  body.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = SPINE_Y;
  pelvis.add(spine);

  const chest = new THREE.Group();
  chest.position.y = CHEST_Y;
  spine.add(chest);

  const neck = new THREE.Group();
  neck.position.y = NECK_Y;
  chest.add(neck);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  neck.add(head);

  // ----------------------------------------------------------------- pelvis
  add(pelvis, rbox(0.3, 0.19, 0.21, 0.05), mats.trousers, [0, 0.01, 0]);
  // iliac wings
  const iliumL = add(pelvis, new THREE.SphereGeometry(0.072, fine ? 14 : 8, 8), mats.bone, [0.068, 0.02, -0.015], undefined, 'bone');
  iliumL.scale.set(1.3, 1.15, 0.6);
  const iliumR = add(pelvis, new THREE.SphereGeometry(0.072, fine ? 14 : 8, 8), mats.bone, [-0.068, 0.02, -0.015], undefined, 'bone');
  iliumR.scale.set(1.3, 1.15, 0.6);
  add(pelvis, rbox(0.09, 0.13, 0.05, 0.015), mats.bone, [0, 0.01, -0.055], undefined, 'bone');
  add(pelvis, rbox(0.075, 0.07, 0.045, 0.02), mats.cartilage, [0, 0.01, 0.04], undefined, 'bone');

  // ------------------------------------------------------------------ spine
  for (let i = 0; i < 5; i += 1) {
    add(spine, rbox(0.052, 0.022, 0.048, 0.008), mats.bone, [0, 0.005 + i * 0.028, -0.02], undefined, 'bone');
  }
  add(spine, rbox(0.12, 0.05, 0.03, 0.012), mats.bone, [0, 0.06, -0.045], undefined, 'bone');
  muscle(spine, 0.045, 0.09, 0.0, 0.04, 0.075, [1.5, 1, 0.55]);
  if (fine) {
    muscle(spine, 0.03, 0.11, 0.075, 0.04, 0.05, [0.75, 1, 0.4]);
    muscle(spine, 0.03, 0.11, -0.075, 0.04, 0.05, [0.75, 1, 0.4]);
  }

  // ------------------------------------------------------------------ chest
  add(chest, rbox(0.355, 0.4, 0.225, 0.055), mats.tunic, [0, 0.08, 0]);
  add(chest, rbox(0.17, 0.05, 0.15, 0.02), mats.shirt, [0, 0.285, 0.005]);
  add(chest, rbox(0.2, 0.05, 0.04, 0.014), mats.tunicShade, [0, 0.3, 0.02]);
  add(chest, rbox(0.045, 0.3, 0.018, 0.01), mats.tunicShade, [-0.085, 0.14, 0.114], [0, 0, 0.1]);
  add(chest, rbox(0.045, 0.3, 0.018, 0.01), mats.tunicShade, [0.085, 0.14, 0.114], [0, 0, -0.1]);
  add(chest, rbox(0.12, 0.022, 0.075, 0.01), mats.accent, [-0.155, 0.285, 0]);
  add(chest, rbox(0.12, 0.022, 0.075, 0.01), mats.accent, [0.155, 0.285, 0]);
  if (fine) {
    for (let i = 0; i < 4; i += 1) {
      add(chest, new THREE.SphereGeometry(0.011, 8, 8), mats.badge, [0.0, 0.0 + i * 0.068, 0.118]);
    }
    add(chest, rbox(0.03, 0.2, 0.1, 0.012), mats.brassard, [-0.192, 0.12, 0.0]);
  }

  // sternum and ribs
  add(chest, rbox(0.045, 0.24, 0.025, 0.01), mats.bone, [0, 0.15, 0.1], undefined, 'bone');
  for (let i = 0; i < 7; i += 1) {
    const r = 0.092 + i * 0.005;
    const geo = new THREE.TorusGeometry(r, 0.0075, 5, 20);
    const rib = add(chest, geo, mats.bone, [0, 0.245 - i * 0.03, -0.005], undefined, 'bone');
    rib.rotation.x = Math.PI / 2 + 0.12;
    rib.scale.set(1.08, 1, 0.78);
  }
  // clavicles and scapulae
  const clavL = add(chest, new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6), mats.bone, [0.1, 0.3, 0.03], undefined, 'bone');
  clavL.rotation.z = Math.PI / 2 - 0.2;
  const clavR = add(chest, new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6), mats.bone, [-0.1, 0.3, 0.03], undefined, 'bone');
  clavR.rotation.z = -(Math.PI / 2 - 0.2);
  const scapL = add(chest, rbox(0.1, 0.13, 0.02, 0.008), mats.bone, [0.11, 0.2, -0.095], [0, 0.25, 0.15], 'bone');
  const scapR = add(chest, rbox(0.1, 0.13, 0.02, 0.008), mats.bone, [-0.11, 0.2, -0.095], [0, -0.25, -0.15], 'bone');
  void scapL;
  void scapR;
  // pectorals, abdominals, trapezius
  muscle(chest, 0.055, 0.09, 0.085, 0.2, 0.095, [1.15, 1, 0.5]);
  muscle(chest, 0.055, 0.09, -0.085, 0.2, 0.095, [1.15, 1, 0.5]);
  for (let i = 0; i < 3; i += 1) {
    muscle(chest, 0.03, 0.05, 0.035, 0.02 + i * 0.06, 0.1, [1.1, 1, 0.45]);
    muscle(chest, 0.03, 0.05, -0.035, 0.02 + i * 0.06, 0.1, [1.1, 1, 0.45]);
  }
  muscle(chest, 0.035, 0.16, 0.14, 0.27, -0.03, [1, 1, 0.6]);
  muscle(chest, 0.035, 0.16, -0.14, 0.27, -0.03, [1, 1, 0.6]);

  // ------------------------------------------------------------------- neck
  add(neck, new THREE.CylinderGeometry(0.042, 0.05, 0.075, 12), mats.skin, [0, 0.02, 0]);
  for (let i = 0; i < 3; i += 1) {
    add(neck, rbox(0.042, 0.016, 0.038, 0.006), mats.bone, [0, 0.0 + i * 0.024, -0.005], undefined, 'bone');
  }

  // ------------------------------------------------------------------- head
  const skull = add(head, new THREE.SphereGeometry(0.099, fine ? 22 : 12, fine ? 16 : 10), mats.skin, [0, 0.1, 0]);
  skull.scale.set(0.95, 1.12, 1.0);
  const jaw = add(head, new THREE.SphereGeometry(0.072, 14, 10), mats.skin, [0, 0.04, 0.022]);
  jaw.scale.set(0.9, 0.82, 0.95);
  add(head, new THREE.SphereGeometry(0.026, 8, 8), mats.skin, [0, 0.095, 0.097]);
  add(head, new THREE.SphereGeometry(0.022, 8, 8), mats.skin, [-0.096, 0.105, 0.005]);
  add(head, new THREE.SphereGeometry(0.022, 8, 8), mats.skin, [0.096, 0.105, 0.005]);
  add(head, new THREE.SphereGeometry(0.035, 10, 10), mats.hair, [0, 0.07, -0.06]);

  // skull, mandible, orbits, nasal aperture
  const cranium = add(head, new THREE.SphereGeometry(0.09, fine ? 18 : 10, fine ? 14 : 8), mats.bone, [0, 0.11, 0], undefined, 'bone');
  cranium.scale.set(0.95, 1.08, 1.0);
  add(head, rbox(0.1, 0.05, 0.075, 0.02), mats.bone, [0, 0.035, 0.03], undefined, 'bone');
  add(head, new THREE.SphereGeometry(0.021, 8, 8), mats.socket, [-0.038, 0.11, 0.078], undefined, 'bone');
  add(head, new THREE.SphereGeometry(0.021, 8, 8), mats.socket, [0.038, 0.11, 0.078], undefined, 'bone');
  add(head, rbox(0.018, 0.028, 0.02, 0.006), mats.socket, [0, 0.075, 0.092], undefined, 'bone');

  const beret = new THREE.Group();
  beret.position.set(0, 0.177, -0.008);
  beret.rotation.z = -0.1;
  beret.rotation.x = -0.05;
  head.add(beret);
  const crown = add(beret, new THREE.SphereGeometry(0.118, 18, 12), mats.beret, [0.012, 0.012, 0.012]);
  crown.scale.set(1.06, 0.42, 1.02);
  add(beret, new THREE.TorusGeometry(0.1, 0.012, 8, 22), mats.beret, [0.005, -0.012, 0.006], [Math.PI / 2, 0, 0]);
  add(beret, rbox(0.034, 0.03, 0.012, 0.006), mats.badge, [0.0, 0.0, 0.107]);

  // =================================================================== arms
  const makeArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, SHOULDER_Y, 0);
    chest.add(shoulder);
    const upper = new THREE.Group();
    shoulder.add(upper);
    add(upper, new THREE.CapsuleGeometry(0.058, 0.18, 5, 12), mats.tunic, [0, -HUMERUS / 2, 0]);
    if (fine) add(upper, new THREE.SphereGeometry(0.064, 12, 10), mats.tunic, [0, -0.02, 0]);
    jointBall(shoulder, 0.03, 0, 0, 0);
    bone(upper, HUMERUS, 0.024);
    jointBall(upper, 0.02, 0, -HUMERUS, 0);
    // deltoid, biceps, triceps
    muscle(shoulder, 0.05, 0.07, 0, -0.045, 0, [1.15, 1, 1.1]);
    muscle(upper, 0.031, 0.13, 0, -0.13, 0.03, [0.85, 1, 0.7]);
    muscle(upper, 0.032, 0.15, 0, -0.13, -0.03, [0.9, 1, 0.7]);

    const elbow = new THREE.Group();
    elbow.position.y = -HUMERUS;
    upper.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(0.046, 0.16, 5, 12), mats.tunic, [0, -FOREARM / 2, 0]);
    bone(elbow, FOREARM, 0.017, -0.012);
    bone(elbow, FOREARM, 0.012, 0.014);
    muscle(elbow, 0.03, 0.1, 0, -0.09, 0.02, [0.8, 1, 0.8]);

    const hand = new THREE.Group();
    hand.position.y = -FOREARM;
    elbow.add(hand);
    add(hand, rbox(0.062, 0.1, 0.05, 0.02), mats.skin, [0, -0.04, 0.004]);
    add(hand, rbox(0.052, 0.07, 0.028, 0.012), mats.bone, [0, -0.06, 0.004], undefined, 'bone');
    if (fine) {
      for (let i = 0; i < 4; i += 1) {
        add(hand, new THREE.CapsuleGeometry(0.0075, 0.035, 3, 6), mats.bone, [-0.02 + i * 0.013, -0.105, 0.006], undefined, 'bone');
      }
      add(hand, new THREE.CapsuleGeometry(0.008, 0.03, 3, 6), mats.bone, [0.036, -0.05, 0.008], [0, 0, -0.9], 'bone');
    }
    return { shoulder, upper, elbow, hand };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // =================================================================== legs
  const makeLeg = (side: 1 | -1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.098, 0, 0);
    pelvis.add(hip);
    const thigh = new THREE.Group();
    hip.add(thigh);
    add(thigh, new THREE.CapsuleGeometry(0.075, 0.32, 5, 12), mats.trousers, [0, -FEMUR / 2 - 0.01, 0]);
    jointBall(hip, 0.032, 0, 0, 0);
    bone(thigh, FEMUR, 0.028);
    add(thigh, new THREE.SphereGeometry(0.032, 10, 8), mats.cartilage, [0, -FEMUR + 0.03, 0.035], undefined, 'bone');
    muscle(thigh, 0.055, 0.26, 0, -0.2, 0.045, [1, 1, 0.75]);
    muscle(thigh, 0.045, 0.2, 0, -0.18, -0.045, [1, 1, 0.7]);
    muscle(pelvis, 0.06, 0.1, side * 0.1, -0.02, -0.06, [1, 1, 0.8]);

    const knee = new THREE.Group();
    knee.position.y = -FEMUR;
    thigh.add(knee);
    add(knee, new THREE.CapsuleGeometry(0.055, 0.31, 5, 12), mats.trousers, [0, -TIBIA / 2, 0]);
    bone(knee, TIBIA, 0.024);
    bone(knee, TIBIA * 0.92, 0.011, 0.024, 0.012);
    jointBall(knee, 0.025, 0, 0, 0);
    muscle(knee, 0.042, 0.2, 0, -0.15, -0.035, [1, 1, 0.75]);

    const ankle = new THREE.Group();
    ankle.position.y = -TIBIA;
    knee.add(ankle);
    add(ankle, rbox(0.1, 0.075, 0.245, 0.025), mats.boots, [0, -0.035, 0.038]);
    add(ankle, rbox(0.098, 0.045, 0.075, 0.02), mats.boots, [0, -0.078, 0.135]);
    add(ankle, rbox(0.096, 0.03, 0.05, 0.012), mats.boots, [0, -0.082, -0.055]);
    add(ankle, rbox(0.075, 0.05, 0.13, 0.015), mats.bone, [0, -0.04, 0.03], undefined, 'bone');
    add(ankle, rbox(0.07, 0.025, 0.06, 0.01), mats.bone, [0, -0.065, 0.11], undefined, 'bone');
    jointBall(ankle, 0.02, 0, 0, 0);
    return { hip, thigh, knee, ankle };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // ======================================================= rifle / colour
  const weapon = new THREE.Group();
  chest.add(weapon);
  add(weapon, rbox(0.055, 0.6, 0.075, 0.018), mats.rifleWood, [0, 0.35, 0]);
  add(weapon, rbox(0.062, 0.25, 0.1, 0.02), mats.rifleWood, [0, 0.115, -0.012], [0.15, 0, 0]);
  add(weapon, rbox(0.046, 0.17, 0.048, 0.014), mats.rifleWood, [0, 0.615, 0.008], [0.06, 0, 0]);
  add(weapon, new THREE.CylinderGeometry(0.012, 0.014, 0.5, 10), mats.rifleMetal, [0, 0.86, 0]);
  add(weapon, rbox(0.05, 0.032, 0.07, 0.01), mats.rifleMetal, [0, 0.56, 0]);
  add(weapon, rbox(0.04, 0.05, 0.09, 0.01), mats.rifleMetal, [0, 0.4, 0.055]);
  add(weapon, new THREE.CylinderGeometry(0.008, 0.008, 0.13, 6), mats.rifleMetal, [0.036, 0.45, 0.0], [0, 0, 0.4]);

  const colour = new THREE.Group();
  chest.add(colour);
  add(colour, new THREE.CylinderGeometry(0.015, 0.017, 2.15, 10), mats.rifleWood, [0, 1.02, 0]);
  add(colour, new THREE.ConeGeometry(0.028, 0.1, 10), mats.badge, [0, 2.14, 0]);
  add(colour, new THREE.SphereGeometry(0.03, 10, 8), mats.badge, [0, 2.2, 0]);
  const flagGroup = new THREE.Group();
  flagGroup.position.set(0.02, 1.97, 0);
  colour.add(flagGroup);
  const flagGeo = new THREE.PlaneGeometry(0.92, 0.6, 12, 8);
  const flagTexture = makeFlagTexture();
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture, side: THREE.DoubleSide, roughness: 0.92 });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.x = 0.46;
  flag.castShadow = true;
  flagGroup.add(flag);
  const flagBase = Float32Array.from(flagGeo.attributes.position.array as Float32Array);

  let angles: JointReading[] = [];
  let mode: BodyMode = 'uniform';

  const applyMode = () => {
    const showUniform = mode === 'uniform' || mode === 'xray';
    uniformMeshes.forEach((m) => (m.visible = showUniform));
    skeletonMeshes.forEach((m) => (m.visible = mode !== 'uniform'));
    muscleMeshes.forEach((m) => (m.visible = mode === 'muscles'));
    const xray = mode === 'xray';
    uniformMats.forEach((m) => {
      if (m.transparent !== xray) {
        m.transparent = xray;
        m.needsUpdate = true;
      }
      m.opacity = xray ? 0.16 : 1;
      m.depthWrite = !xray;
    });
  };
  applyMode();

  return {
    group,
    setTransform(x, z, heading) {
      group.position.set(x, 0, z);
      group.rotation.y = heading;
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
    animate(anim) {
      const a = targetsFor(anim.from, hasRifle, hasColour);
      const b = targetsFor(anim.to, hasRifle, hasColour);
      const u = Math.min(1, Math.max(0, anim.u));
      if (anim.dressing && !hasRifle && !hasColour) {
        a.handR = [-0.66, 0.32, -0.02];
        b.handR = [-0.66, 0.32, -0.02];
        a.handL = [0.235, -0.1, 0.02];
        b.handL = [0.235, -0.1, 0.02];
      }

      const posture = anim.to.posture;
      const gait = GAIT_ANATOMY[anim.gait] ?? GAIT_ANATOMY.halt;
      const spineTarget = DRILL_SPINE[posture] ?? DRILL_SPINE.attention;
      const moving = anim.gait === 'quick' || anim.gait === 'slow' || anim.gait === 'double';
      const marking = anim.gait === 'markTime';
      const phase = moving ? (anim.stride / 1.5) * Math.PI * 2 : marking ? anim.time * Math.PI * 4 : 0;
      const s = Math.sin(phase);

      // --- trunk: posture, gait lean, pelvic and thoracic counter-rotation
      const lean = gait.trunk + (posture === 'standEasy' ? 2 : posture === 'salute' ? -2 : 0);
      const twist = moving || marking ? s * 3.5 : 0;
      pelvis.rotation.set(rad(clampJoint('lumbarFlexion', lean * 0.4)), rad(-twist * 0.55), rad(s * 2));
      spine.rotation.set(rad(clampJoint('lumbarFlexion', lean * 0.6)), rad(twist * 0.35), 0);
      chest.rotation.set(rad(clampJoint('thoracicRotation', twist * 0.5)), rad(twist * 0.4), rad(-s * 1.2));

      // --- head and neck: eyes right/left is cervical rotation, head level
      const eyes = anim.eyes;
      const cervical = eyes === 'right' ? -EYES_RIGHT.cervical : eyes === 'left' ? EYES_RIGHT.cervical : 0;
      neck.rotation.y = rad(cervical * 0.55);
      neck.rotation.x = rad(spineTarget.cervical * 0.5);
      head.rotation.y = rad(cervical * 0.45 - twist * 0.5);
      head.rotation.x = rad(spineTarget.cervical * 0.5);
      beret.visible = anim.headdress === 'worn';

      // --- weapon and colour carriage
      const weaponRot = a.weapon && b.weapon ? (lerpV(a.weapon, b.weapon, u) as Rot) : (b.weapon ?? a.weapon);
      const colourRot = a.colour && b.colour ? (lerpV(a.colour, b.colour, u) as Rot) : (b.colour ?? a.colour);
      weapon.visible = !!weaponRot && hasRifle;
      colour.visible = !!colourRot && hasColour;

      const handL = lerpV(a.handL, b.handL, u);
      const handR = lerpV(a.handR, b.handR, u);

      // arm swing from the shoulder while marching, unless that arm carries kit
      const freeLeft = !hasRifle && !hasColour;
      if ((moving || marking) && freeLeft) {
        const swing = rad(gait.shoulderSwing);
        const amp = Math.sin(swing) * 0.52;
        const lift = (1 - Math.cos(swing)) * 0.52;
        handR[2] -= s * amp;
        handL[2] += s * amp;
        handR[1] += Math.abs(s) * lift;
        handL[1] += Math.abs(s) * lift;
      }

      if (weaponRot) {
        const euler = new THREE.Euler(rad(weaponRot[0]), rad(weaponRot[1]), rad(weaponRot[2]));
        weapon.quaternion.setFromEuler(euler);
        const offset = new THREE.Vector3(0, 0.36, 0).applyQuaternion(weapon.quaternion);
        weapon.position.set(handR[0] - offset.x, handR[1] - CHEST_Y - offset.y, handR[2] - offset.z);
      }
      if (colourRot) {
        const euler = new THREE.Euler(rad(colourRot[0]), rad(colourRot[1]), rad(colourRot[2]));
        colour.quaternion.setFromEuler(euler);
        const offset = new THREE.Vector3(0, 0.78, 0).applyQuaternion(colour.quaternion);
        colour.position.set(handR[0] - offset.x, handR[1] - CHEST_Y - offset.y, handR[2] - offset.z);
      }

      // hands are given in torso space; the arm chain lives in chest space
      solveArm(armL, [0.2, SHOULDER_Y, 0], [handL[0], handL[1] - CHEST_Y, handL[2]], 1);
      solveArm(armR, [-0.2, SHOULDER_Y, 0], [handR[0], handR[1] - CHEST_Y, handR[2]], -1);

      // --- legs: hip swing with a knee that folds on the lift and the backswing
      const hipMean = gait.hip * 0.45;
      const amp = gait.hip * 0.55 + (gait.hip > 40 ? 0 : 6);
      const hipL = clampJoint('hipFlexion', hipMean + s * amp);
      const hipR = clampJoint('hipFlexion', hipMean - s * amp);
      const backL = Math.max(0, -s);
      const backR = Math.max(0, s);
      const kneeBase = gait.knee;
      const kneeFold = gait.knee > 40 ? 0 : 22;
      const kneeL = clampJoint('kneeFlexion', kneeBase * (gait.knee > 40 ? clamp01(s) : 1) + kneeFold * backL + 4);
      const kneeR = clampJoint('kneeFlexion', kneeBase * (gait.knee > 40 ? clamp01(-s) : 1) + kneeFold * backR + 4);
      const ankleL = clampJoint('anklePlantar', gait.ankle * (0.45 + 0.55 * backL));
      const ankleR = clampJoint('anklePlantar', gait.ankle * (0.45 + 0.55 * backR));

      legL.thigh.rotation.set(rad(-hipL), 0, 0);
      legR.thigh.rotation.set(rad(-hipR), 0, 0);
      legL.knee.rotation.set(rad(kneeL), 0, 0);
      legR.knee.rotation.set(rad(kneeR), 0, 0);
      legL.ankle.rotation.set(rad(ankleL - hipL * 0.15 - kneeL * 0.25), 0, 0);
      legR.ankle.rotation.set(rad(ankleR - hipR * 0.15 - kneeR * 0.25), 0, 0);

      body.position.y = moving
        ? Math.abs(Math.sin(phase)) * 0.016
        : marking
          ? Math.abs(Math.sin(anim.time * Math.PI * 4)) * 0.012
          : 0;

      // --- measure the actual joints that resulted
      const upperL = new THREE.Vector3(0, -1, 0).applyQuaternion(armL.upper.quaternion);
      const upperR = new THREE.Vector3(0, -1, 0).applyQuaternion(armR.upper.quaternion);
      const foreL = new THREE.Vector3(0, -1, 0).applyQuaternion(
        armL.upper.quaternion.clone().multiply(armL.elbow.quaternion),
      );
      const foreR = new THREE.Vector3(0, -1, 0).applyQuaternion(
        armR.upper.quaternion.clone().multiply(armR.elbow.quaternion),
      );
      const elbowL = deg(Math.acos(Math.max(-1, Math.min(1, upperL.dot(foreL)))));
      const elbowR = deg(Math.acos(Math.max(-1, Math.min(1, upperR.dot(foreR)))));
      angles = [
        reading('hipFlexion', hipL, 'L'),
        reading('hipFlexion', hipR, 'R'),
        reading('kneeFlexion', kneeL, 'L'),
        reading('kneeFlexion', kneeR, 'R'),
        reading('anklePlantar', ankleL, 'L'),
        reading('anklePlantar', ankleR, 'R'),
        reading('shoulderFlexion', deg(Math.atan2(upperL.z, -upperL.y)), 'L'),
        reading('shoulderFlexion', deg(Math.atan2(upperR.z, -upperR.y)), 'R'),
        reading('shoulderAbduction', deg(Math.atan2(upperL.x, -upperL.y)), 'L'),
        reading('shoulderAbduction', deg(Math.atan2(-upperR.x, -upperR.y)), 'R'),
        reading('elbowFlexion', elbowL, 'L'),
        reading('elbowFlexion', elbowR, 'R'),
        reading('cervicalRotation', -cervical),
        reading('thoracicRotation', twist * 0.9),
        reading('lumbarFlexion', lean),
        reading('pelvicTilt', s * 2),
      ];
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
      flagMat.dispose();
      flagTexture.dispose();
    },
  };
}

/** Two-bone IK: shoulder → elbow (pole hint) → hand target, in chest space. */
function solveArm(
  arm: { shoulder: THREE.Group; upper: THREE.Group; elbow: THREE.Group; hand: THREE.Group },
  shoulderPos: V3,
  target: V3,
  side: 1 | -1,
) {
  const S = new THREE.Vector3(shoulderPos[0], shoulderPos[1], shoulderPos[2]);
  const T = new THREE.Vector3(target[0], target[1], target[2]);
  const L1 = HUMERUS;
  const L2 = FOREARM;
  const dir = T.clone().sub(S);
  let dist = dir.length();
  const maxReach = L1 + L2 - 0.015;
  const minReach = Math.abs(L1 - L2) + 0.02;
  dist = Math.max(minReach, Math.min(maxReach, dist));
  dir.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0.0004, L1 * L1 - a * a));
  const base = S.clone().addScaledVector(dir, a);
  const pole = new THREE.Vector3(side * 0.6, 0.05, -0.4);
  const poleDir = pole.sub(base);
  poleDir.addScaledVector(dir, -poleDir.dot(dir));
  if (poleDir.lengthSq() < 1e-6) poleDir.set(0, 0, -1);
  poleDir.normalize();
  const elbowPos = base.clone().addScaledVector(poleDir, h);

  const upperDir = elbowPos.clone().sub(S).normalize();
  const upperQuat = new THREE.Quaternion().setFromUnitVectors(DOWN, upperDir);
  arm.upper.quaternion.copy(upperQuat);

  const handTarget = S.clone().addScaledVector(dir, dist);
  const foreDir = handTarget.clone().sub(elbowPos).normalize();
  const worldForeQuat = new THREE.Quaternion().setFromUnitVectors(DOWN, foreDir);
  const localFore = upperQuat.clone().invert().multiply(worldForeQuat);
  arm.elbow.quaternion.copy(localFore);
}

function makeFlagTexture(): THREE.CanvasTexture {
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
