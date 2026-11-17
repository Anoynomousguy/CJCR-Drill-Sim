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
import {
  ARM_MAX_REACH,
  ARM_MIN_REACH,
  BODY,
  DRESS_HANDS,
  PIKE,
  STRIDE_LENGTH,
  gaitPose,
  handIsGripping,
  mixCarriage,
  poseTargets,
  swingHand,
  type Carriage,
  type Rot,
  type Vec3,
} from '../engine/pose';
import type { Snapshot } from '../engine/types';

type V3 = Vec3;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (v: number) => (v * 180) / Math.PI;

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
}

export interface Figure {
  group: THREE.Group;
  setTransform: (x: number, z: number, heading: number) => void;
  setHeight: (h: number) => void;
  setMode: (mode: BodyMode) => void;
  getAngles: () => JointReading[];
  getCarriage: () => { weapon: Carriage | null; colour: Carriage | null };
  animate: (anim: FigureAnim) => void;
  tick: (dt: number, time: number) => void;
  dispose: () => void;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

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
  // Butt at the origin, muzzle on +Y: the scale the carriage frames use.
  add(weapon, rbox(0.054, 0.3, 0.08, 0.02), mats.rifleWood, [0, 0.15, 0]);
  add(weapon, rbox(0.052, 0.022, 0.082, 0.008), mats.rifleMetal, [0, 0.013, 0]);
  add(weapon, rbox(0.046, 0.14, 0.056, 0.018), mats.rifleWood, [0, 0.365, 0.004]);
  add(weapon, rbox(0.05, 0.15, 0.062, 0.012), mats.rifleMetal, [0, 0.46, 0.002]);
  add(weapon, rbox(0.042, 0.12, 0.05, 0.01), mats.rifleMetal, [0, 0.45, -0.052]);
  add(weapon, new THREE.TorusGeometry(0.024, 0.006, 5, 12), mats.rifleMetal, [0, 0.4, -0.044], [Math.PI / 2, 0, 0]);
  // Fore-end, upper band and barrel: the order grip falls on the band at 0.90.
  add(weapon, rbox(0.05, 0.5, 0.054, 0.018), mats.rifleWood, [0, 0.72, 0.002]);
  add(weapon, rbox(0.054, 0.07, 0.058, 0.012), mats.rifleMetal, [0, 0.94, 0]);
  add(weapon, new THREE.CylinderGeometry(0.011, 0.012, 0.19, 10), mats.rifleMetal, [0, 1.045, 0]);
  add(weapon, rbox(0.016, 0.02, 0.02, 0.004), mats.rifleMetal, [0, 1.1, 0.021]);
  add(weapon, new THREE.CylinderGeometry(0.014, 0.012, 0.022, 10), mats.rifleMetal, [0, 1.122, 0]);
  // Bolt handle on the right and the sling under the fore-end.
  add(weapon, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), mats.rifleMetal, [-0.04, 0.47, 0], [0, 0, 1.15]);
  add(weapon, new THREE.SphereGeometry(0.014, 8, 6), mats.rifleMetal, [-0.086, 0.455, 0]);
  add(weapon, rbox(0.008, 0.42, 0.012, 0.003), mats.belt, [0, 0.34, -0.042]);

  const colour = new THREE.Group();
  chest.add(colour);
  add(colour, new THREE.CylinderGeometry(0.016, 0.018, PIKE.length, 10), mats.rifleWood, [0, PIKE.length / 2, 0]);
  add(colour, new THREE.CylinderGeometry(0.02, 0.016, 0.06, 10), mats.badge, [0, PIKE.length - 0.02, 0]);
  add(colour, new THREE.ConeGeometry(0.03, 0.13, 10), mats.badge, [0, PIKE.length + 0.05, 0]);
  add(colour, new THREE.SphereGeometry(0.028, 10, 8), mats.badge, [0, PIKE.length + 0.12, 0]);
  const flagGroup = new THREE.Group();
  flagGroup.position.set(0.02, PIKE.flagAt, 0);
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
    getCarriage() {
      const frameOf = (group: THREE.Group): Carriage | null => {
        if (!group.visible) return null;
        const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
        return {
          butt: [group.position.x, group.position.y, group.position.z],
          dir: [dir.x, dir.y, dir.z],
          hands: {},
        };
      };
      return { weapon: frameOf(weapon), colour: frameOf(colour) };
    },
    animate(anim) {
      const a = poseTargets(anim.from, hasRifle, hasColour);
      const b = poseTargets(anim.to, hasRifle, hasColour);
      const u = Math.min(1, Math.max(0, anim.u));
      if (anim.dressing && !hasRifle && !hasColour) {
        a.handL = DRESS_HANDS.left;
        b.handL = DRESS_HANDS.left;
        a.handR = DRESS_HANDS.right;
        b.handR = DRESS_HANDS.right;
      }

      const posture = anim.to.posture;
      const gait = GAIT_ANATOMY[anim.gait] ?? GAIT_ANATOMY.halt;
      const spineTarget = DRILL_SPINE[posture] ?? DRILL_SPINE.attention;
      const moving = anim.gait === 'quick' || anim.gait === 'slow' || anim.gait === 'double';
      const marking = anim.gait === 'markTime';
      const phase = moving
        ? (anim.stride / STRIDE_LENGTH) * Math.PI * 2
        : marking
          ? anim.time * Math.PI * 4
          : 0;
      const s = Math.sin(phase);

      // --- trunk: posture, gait lean, pelvic and thoracic counter-rotation
      const lean = gait.trunk + (posture === 'standEasy' ? 2 : posture === 'salute' ? -2 : 0);
      const twist = moving || marking ? s * 3.5 : 0;
      pelvis.rotation.set(rad(clampJoint('lumbarFlexion', lean * 0.4)), rad(-twist * 0.55), rad(s * 2));
      spine.rotation.set(rad(clampJoint('lumbarFlexion', lean * 0.6)), rad(twist * 0.35), 0);
      chest.rotation.set(0, rad(twist * 0.4), rad(-s * 1.2));

      // --- head and neck: eyes right/left is cervical rotation, head level
      const eyes = anim.eyes;
      const cervical = eyes === 'right' ? -EYES_RIGHT.cervical : eyes === 'left' ? EYES_RIGHT.cervical : 0;
      neck.rotation.y = rad(cervical * 0.55);
      neck.rotation.x = rad(spineTarget.cervical * 0.5);
      head.rotation.y = rad(cervical * 0.45 - twist * 0.5);
      head.rotation.x = rad(spineTarget.cervical * 0.5);
      beret.visible = anim.headdress === 'worn';

      // --- rifle and colour: place the frame, then the hands on its grips
      const weaponFrame = mixCarriage(a.weapon, b.weapon, u);
      const colourFrame = mixCarriage(a.colour, b.colour, u);
      weapon.visible = !!weaponFrame && hasRifle;
      colour.visible = !!colourFrame && hasColour;
      if (weaponFrame) placeCarriage(weapon, weaponFrame);
      if (colourFrame) placeCarriage(colour, colourFrame);

      let handL = lerpV(a.handL, b.handL, u);
      let handR = lerpV(a.handR, b.handR, u);

      // a free arm swings from the shoulder; a hand on kit stays on its grip
      if (moving || marking) {
        const swing = gait.shoulderSwing * s;
        if (!handIsGripping(a, 'L') && !handIsGripping(b, 'L')) handL = swingHand(handL, -swing, gait.elbow);
        if (!handIsGripping(a, 'R') && !handIsGripping(b, 'R')) handR = swingHand(handR, swing, gait.elbow);
      }

      solveArm(armL, [BODY.shoulderX, SHOULDER_Y, 0], handL, 1);
      solveArm(armR, [-BODY.shoulderX, SHOULDER_Y, 0], handR, -1);

      // --- legs: the gait model, already clamped to the joint ranges
      const gp = gaitPose(anim.gait, phase);
      legL.thigh.rotation.set(rad(-gp.hipL), 0, 0);
      legR.thigh.rotation.set(rad(-gp.hipR), 0, 0);
      legL.knee.rotation.set(rad(gp.kneeL), 0, 0);
      legR.knee.rotation.set(rad(gp.kneeR), 0, 0);
      legL.ankle.rotation.set(rad(gp.ankleL), 0, 0);
      legR.ankle.rotation.set(rad(gp.ankleR), 0, 0);

      body.position.y = moving
        ? Math.abs(Math.sin(phase)) * 0.016
        : marking
          ? Math.abs(Math.sin(anim.time * Math.PI * 4)) * 0.012
          : 0;

      // --- measure the joints that actually resulted
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
      // Elevation from straight down, split into a sagittal and a frontal part.
      const limb = (v: THREE.Vector3, mirror: 1 | -1) => {
        const len = v.length() || 1;
        const elevation = Math.acos(Math.max(-1, Math.min(1, -v.y / len)));
        const azimuth = Math.atan2((v.x / len) * mirror, v.z / len);
        return {
          flexion: deg(elevation * Math.cos(azimuth)),
          abduction: deg(elevation * Math.sin(azimuth)),
        };
      };
      const armLimb = limb(upperL, 1);
      const armRLimb = limb(upperR, -1);

      angles = [
        reading('hipFlexion', deg(-legL.thigh.rotation.x), 'L'),
        reading('hipFlexion', deg(-legR.thigh.rotation.x), 'R'),
        reading('kneeFlexion', deg(legL.knee.rotation.x), 'L'),
        reading('kneeFlexion', deg(legR.knee.rotation.x), 'R'),
        reading('anklePlantar', deg(legL.ankle.rotation.x), 'L'),
        reading('anklePlantar', deg(legR.ankle.rotation.x), 'R'),
        reading('shoulderFlexion', armLimb.flexion, 'L'),
        reading('shoulderFlexion', armRLimb.flexion, 'R'),
        reading('shoulderAbduction', armLimb.abduction, 'L'),
        reading('shoulderAbduction', armRLimb.abduction, 'R'),
        reading('elbowFlexion', elbowL, 'L'),
        reading('elbowFlexion', elbowR, 'R'),
        reading('cervicalRotation', deg(-(neck.rotation.y + head.rotation.y))),
        reading('thoracicRotation', deg(spine.rotation.y + chest.rotation.y)),
        reading('lumbarFlexion', deg(pelvis.rotation.x + spine.rotation.x)),
        reading('pelvicTilt', deg(pelvis.rotation.z)),
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
      flagTexture?.dispose();
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
  const maxReach = ARM_MAX_REACH;
  const minReach = ARM_MIN_REACH;
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

function makeFlagTexture(): THREE.CanvasTexture | null {
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
