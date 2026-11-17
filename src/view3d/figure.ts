import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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

const SKIN = '#c79a72';

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
  };
  const allMats = Object.values(mats);

  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    pos: V3,
    rot?: Rot,
  ) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r);

  const HIP = 0.92;

  // ---------------------------------------------------------------- torso
  const torso = new THREE.Group();
  torso.position.y = HIP;
  body.add(torso);

  add(torso, rbox(0.3, 0.18, 0.21, 0.05), mats.trousers, [0, 0.02, 0]);
  add(torso, rbox(0.355, 0.34, 0.225, 0.055), mats.tunic, [0, 0.4, 0]);
  add(torso, rbox(0.375, 0.13, 0.235, 0.035), mats.tunic, [0, 0.185, 0]);
  add(torso, rbox(0.38, 0.062, 0.245, 0.018), mats.belt, [0, 0.238, 0]);
  add(torso, rbox(0.07, 0.05, 0.02, 0.012), mats.badge, [0, 0.238, 0.126]);
  // collar and shirt
  add(torso, rbox(0.17, 0.05, 0.15, 0.02), mats.shirt, [0, 0.585, 0.005]);
  add(torso, rbox(0.2, 0.05, 0.04, 0.014), mats.tunicShade, [0, 0.6, 0.02]);
  add(torso, rbox(0.045, 0.3, 0.018, 0.01), mats.tunicShade, [-0.085, 0.44, 0.114], [0, 0, 0.1]);
  add(torso, rbox(0.045, 0.3, 0.018, 0.01), mats.tunicShade, [0.085, 0.44, 0.114], [0, 0, -0.1]);
  // shoulder straps
  add(torso, rbox(0.12, 0.022, 0.075, 0.01), mats.accent, [-0.155, 0.585, 0]);
  add(torso, rbox(0.12, 0.022, 0.075, 0.01), mats.accent, [0.155, 0.585, 0]);
  if (fine) {
    for (let i = 0; i < 4; i += 1) {
      add(torso, new THREE.SphereGeometry(0.011, 8, 8), mats.badge, [0.0, 0.3 + i * 0.068, 0.118]);
    }
    // brassard on the upper right arm side
    add(torso, rbox(0.03, 0.2, 0.1, 0.012), mats.brassard, [-0.192, 0.42, 0.0]);
  }

  // ----------------------------------------------------------------- head
  const neck = new THREE.Group();
  neck.position.set(0, 0.6, 0);
  torso.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  add(head, new THREE.CylinderGeometry(0.042, 0.05, 0.075, 12), mats.skin, [0, 0.015, 0]);
  const skull = add(head, new THREE.SphereGeometry(0.099, fine ? 22 : 12, fine ? 16 : 10), mats.skin, [0, 0.135, 0]);
  skull.scale.set(0.95, 1.12, 1.0);
  const jaw = add(head, new THREE.SphereGeometry(0.072, 14, 10), mats.skin, [0, 0.075, 0.022]);
  jaw.scale.set(0.9, 0.82, 0.95);
  add(head, new THREE.SphereGeometry(0.026, 8, 8), mats.skin, [0, 0.13, 0.097]);
  add(head, new THREE.SphereGeometry(0.022, 8, 8), mats.skin, [-0.096, 0.14, 0.005]);
  add(head, new THREE.SphereGeometry(0.022, 8, 8), mats.skin, [0.096, 0.14, 0.005]);
  add(head, new THREE.SphereGeometry(0.035, 10, 10), mats.hair, [0, 0.105, -0.06]);

  const beret = new THREE.Group();
  beret.position.set(0, 0.212, -0.008);
  beret.rotation.z = -0.1;
  beret.rotation.x = -0.05;
  head.add(beret);
  const crown = add(beret, new THREE.SphereGeometry(0.118, 18, 12), mats.beret, [0.012, 0.012, 0.012]);
  crown.scale.set(1.06, 0.42, 1.02);
  add(beret, new THREE.TorusGeometry(0.1, 0.012, 8, 22), mats.beret, [0.005, -0.012, 0.006], [Math.PI / 2, 0, 0]);
  add(beret, rbox(0.034, 0.03, 0.012, 0.006), mats.badge, [0.0, 0.0, 0.107]);

  // ----------------------------------------------------------------- arms
  const L1 = 0.27;
  const L2 = 0.245;
  const shoulderY = 0.47;

  const makeArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, shoulderY, 0);
    torso.add(shoulder);
    const upper = new THREE.Group();
    shoulder.add(upper);
    add(upper, new THREE.CapsuleGeometry(0.058, 0.18, 5, 12), mats.tunic, [0, -L1 / 2, 0]);
    if (fine) add(upper, new THREE.SphereGeometry(0.064, 12, 10), mats.tunic, [0, -0.02, 0]);
    const elbow = new THREE.Group();
    elbow.position.y = -L1;
    upper.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(0.046, 0.16, 5, 12), mats.tunic, [0, -L2 / 2, 0]);
    const hand = new THREE.Group();
    hand.position.y = -L2;
    elbow.add(hand);
    add(hand, rbox(0.062, 0.1, 0.05, 0.02), mats.skin, [0, -0.04, 0.004]);
    return { shoulder, upper, elbow, hand };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // ----------------------------------------------------------------- legs
  const makeLeg = (side: 1 | -1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.098, HIP, 0);
    body.add(hip);
    const thigh = new THREE.Group();
    hip.add(thigh);
    add(thigh, new THREE.CapsuleGeometry(0.075, 0.32, 5, 12), mats.trousers, [0, -0.225, 0]);
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    thigh.add(knee);
    add(knee, new THREE.CapsuleGeometry(0.055, 0.31, 5, 12), mats.trousers, [0, -0.21, 0]);
    const ankle = new THREE.Group();
    ankle.position.y = -0.42;
    knee.add(ankle);
    add(ankle, rbox(0.1, 0.075, 0.245, 0.025), mats.boots, [0, -0.035, 0.038]);
    add(ankle, rbox(0.098, 0.045, 0.075, 0.02), mats.boots, [0, -0.078, 0.135]);
    add(ankle, rbox(0.096, 0.03, 0.05, 0.012), mats.boots, [0, -0.082, -0.055]);
    return { hip, thigh, knee, ankle };
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // ------------------------------------------------------- rifle / colour
  const weapon = new THREE.Group();
  torso.add(weapon);
  const rifleGeo = {
    stock: rbox(0.055, 0.6, 0.075, 0.018),
    butt: rbox(0.062, 0.25, 0.1, 0.02),
    barrel: new THREE.CylinderGeometry(0.012, 0.014, 0.5, 10),
  };
  add(weapon, rifleGeo.stock, mats.rifleWood, [0, 0.35, 0]);
  add(weapon, rifleGeo.butt, mats.rifleWood, [0, 0.115, -0.012], [0.15, 0, 0]);
  add(weapon, rbox(0.046, 0.17, 0.048, 0.014), mats.rifleWood, [0, 0.615, 0.008], [0.06, 0, 0]);
  add(weapon, rifleGeo.barrel, mats.rifleMetal, [0, 0.86, 0]);
  add(weapon, rbox(0.05, 0.032, 0.07, 0.01), mats.rifleMetal, [0, 0.56, 0]);
  add(weapon, rbox(0.04, 0.05, 0.09, 0.01), mats.rifleMetal, [0, 0.4, 0.055]);
  add(weapon, new THREE.CylinderGeometry(0.008, 0.008, 0.13, 6), mats.rifleMetal, [0.036, 0.45, 0.0], [0, 0, 0.4]);
  if (fine) {
    add(weapon, new THREE.TorusGeometry(0.05, 0.005, 6, 14, Math.PI * 0.9), mats.rifleMetal, [0, 0.44, -0.02], [0, Math.PI / 2, 0]);
  }

  const colour = new THREE.Group();
  torso.add(colour);
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

  let opacity = 1;

  return {
    group,
    setTransform(x, z, heading) {
      group.position.set(x, 0, z);
      group.rotation.y = heading;
    },
    setHeight(h) {
      group.scale.setScalar(h / 1.78);
    },
    animate(anim) {
      const a = targetsFor(anim.from, hasRifle, hasColour);
      const b = targetsFor(anim.to, hasRifle, hasColour);
      const u = Math.min(1, Math.max(0, anim.u));
      if (anim.dressing && !hasRifle && !hasColour) {
        // Right dress: right arm raised behind the shoulder of the person on the right.
        a.handR = [-0.66, 0.32, -0.02];
        b.handR = [-0.66, 0.32, -0.02];
        a.handL = [0.235, -0.1, 0.02];
        b.handL = [0.235, -0.1, 0.02];
      }
      torso.rotation.set(lerp(a.torso[0], b.torso[0], u), 0, lerp(a.torso[2], b.torso[2], u));
      const eye = anim.eyes === 'right' ? -0.55 : anim.eyes === 'left' ? 0.55 : 0;
      head.rotation.set(0, eye, 0);
      beret.visible = anim.headdress === 'worn';

      const weaponRot = a.weapon && b.weapon ? (lerpV(a.weapon, b.weapon, u) as Rot) : (b.weapon ?? a.weapon);
      const colourRot = a.colour && b.colour ? (lerpV(a.colour, b.colour, u) as Rot) : (b.colour ?? a.colour);
      weapon.visible = !!weaponRot && hasRifle;
      colour.visible = !!colourRot && hasColour;

      const handL = lerpV(a.handL, b.handL, u);
      const handR = lerpV(a.handR, b.handR, u);

      if (weaponRot) {
        const euler = new THREE.Euler(deg(weaponRot[0]), deg(weaponRot[1]), deg(weaponRot[2]));
        weapon.quaternion.setFromEuler(euler);
        const offset = new THREE.Vector3(0, 0.36, 0).applyQuaternion(weapon.quaternion);
        weapon.position.set(handR[0] - offset.x, handR[1] - offset.y, handR[2] - offset.z);
      }
      if (colourRot) {
        const euler = new THREE.Euler(deg(colourRot[0]), deg(colourRot[1]), deg(colourRot[2]));
        colour.quaternion.setFromEuler(euler);
        const offset = new THREE.Vector3(0, 0.78, 0).applyQuaternion(colour.quaternion);
        colour.position.set(handR[0] - offset.x, handR[1] - offset.y, handR[2] - offset.z);
      }

      solveArm(armL, [0.2, shoulderY, 0], handL, 1);
      solveArm(armR, [-0.2, shoulderY, 0], handR, -1);

      const moving = anim.gait === 'quick' || anim.gait === 'double' || anim.gait === 'slow';
      const marking = anim.gait === 'markTime';
      const swing = anim.gait === 'slow' ? 0.5 : anim.gait === 'double' ? 1.2 : 0.9;
      const phase = moving ? (anim.stride / 1.5) * Math.PI * 2 : marking ? anim.time * Math.PI * 4 : 0;
      const legAmp = (moving ? 0.34 : 0) * swing;
      const kneeAmp = (moving ? 0.85 : 0) * swing;
      const markL = marking ? Math.max(0, Math.sin(anim.time * Math.PI * 4)) : 0;
      const markR = marking ? Math.max(0, -Math.sin(anim.time * Math.PI * 4)) : 0;
      legL.thigh.rotation.x = -Math.sin(phase) * legAmp - markL * 0.45;
      legR.thigh.rotation.x = Math.sin(phase) * legAmp - markR * 0.45;
      legL.knee.rotation.x = Math.max(0, Math.sin(phase)) * kneeAmp + 0.04 + markL * 0.8;
      legR.knee.rotation.x = Math.max(0, -Math.sin(phase)) * kneeAmp + 0.04 + markR * 0.8;
      legL.ankle.rotation.x = -legL.thigh.rotation.x * 0.35 - legL.knee.rotation.x * 0.55;
      legR.ankle.rotation.x = -legR.thigh.rotation.x * 0.35 - legR.knee.rotation.x * 0.55;
      body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.016 : marking ? Math.abs(Math.sin(anim.time * Math.PI * 4)) * 0.012 : 0;
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
      void opacity;
    },
  };
}

function deg(v: number) {
  return (v * Math.PI) / 180;
}

/** Two-bone IK: shoulder → elbow (pole hint) → hand target. */
function solveArm(
  arm: { shoulder: THREE.Group; upper: THREE.Group; elbow: THREE.Group; hand: THREE.Group },
  shoulderPos: V3,
  target: V3,
  side: 1 | -1,
) {
  const S = new THREE.Vector3(shoulderPos[0], shoulderPos[1], shoulderPos[2]);
  const T = new THREE.Vector3(target[0], target[1], target[2]);
  const L1 = 0.27;
  const L2 = 0.245;
  const dir = T.clone().sub(S);
  let dist = dir.length();
  const maxReach = L1 + L2 - 0.015;
  const minReach = Math.abs(L1 - L2) + 0.02;
  dist = Math.max(minReach, Math.min(maxReach, dist));
  dir.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const hSq = Math.max(0.0004, L1 * L1 - a * a);
  const h = Math.sqrt(hSq);
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
