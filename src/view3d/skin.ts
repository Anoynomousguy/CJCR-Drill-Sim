// Skinned body surface.
//
// The old figure was a set of rigid primitives: a box for the trunk and a
// capsule per bone. That is why the shoulders read as balls sitting on a
// fridge and the elbows as two tubes butted together. A body is one surface
// over a skeleton, and the surface has a shape: a ribcage that narrows to a
// waist, glutes behind the pelvis, a deltoid cap over the shoulder, a
// gastrocnemius belly behind the shank.
//
// This module lofts that surface from anatomical cross-sections and binds it
// to the same bones the drill engine rotates. Every station carries its own
// bone weights, so the skin bends where the body bends, and the weights are
// spread over several rings at each joint instead of switching at a seam.
//
// Coordinates: body space at the rest pose. +Y up, +Z forward, +X the cadet's
// left, origin on the ground under the pelvis. That is the space every bone
// lives in before a movement rotates it.

import * as THREE from 'three';
import { useDualQuaternionSkinning } from './dualQuat';

export type SkinBoneName =
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'clav.L'
  | 'upperArm.L'
  | 'foreArm.L'
  | 'hand.L'
  | 'clav.R'
  | 'upperArm.R'
  | 'foreArm.R'
  | 'hand.R'
  | 'thigh.L'
  | 'shin.L'
  | 'foot.L'
  | 'toe.L'
  | 'thigh.R'
  | 'shin.R'
  | 'foot.R'
  | 'toe.R';

/** Skeleton order. Skin indices point into this list. */
export const SKIN_BONES: readonly SkinBoneName[] = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'clav.L',
  'upperArm.L',
  'foreArm.L',
  'hand.L',
  'clav.R',
  'upperArm.R',
  'foreArm.R',
  'hand.R',
  'thigh.L',
  'shin.L',
  'foot.L',
  'toe.L',
  'thigh.R',
  'shin.R',
  'foot.R',
  'toe.R',
];

export type SkinMaterial = 'tunic' | 'trousers' | 'skin';

/** Bone names before the side suffix; the part supplies .L or .R. */
export type SkinWeightBone =
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'clav'
  | 'upperArm'
  | 'foreArm'
  | 'hand'
  | 'thigh'
  | 'shin'
  | 'foot'
  | 'toe';

const SIDED: readonly SkinWeightBone[] = [
  'clav',
  'upperArm',
  'foreArm',
  'hand',
  'thigh',
  'shin',
  'foot',
  'toe',
];

export interface SkinStation {
  /** Height of the cross-section centre. */
  y: number;
  /** Lateral offset of the centre; the arms hang outside the midline. */
  x?: number;
  /** Forward offset of the centre; a calf sits behind the shank's axis. */
  z?: number;
  /** Half-width and half-depth of the section. */
  rx: number;
  rz: number;
  /** Superellipse exponent: 2 is an ellipse, higher flattens the sides. */
  power?: number;
  weights: Partial<Record<SkinWeightBone, number>>;
}

export interface SkinPart {
  /** Bottom station first; the loft runs upward. */
  stations: SkinStation[];
  material: SkinMaterial;
  name: string;
  side?: 'L' | 'R';
}

export interface SkinBuild {
  meshes: THREE.SkinnedMesh[];
  skeleton: THREE.Skeleton;
  parts: SkinPart[];
}

const W = (weights: Partial<Record<SkinWeightBone, number>>) => weights;

// --------------------------------------------------------------------- trunk
// Waist 27 cm across, chest 34 cm, shoulders 36 cm plus the deltoid caps: a
// lean 1.78 m body. The glutes push the pelvis section back, the chest sits
// slightly forward of the waist, and the trapezius slopes from the neck to the
// acromion instead of ending in a flat shelf.
function trunkStations(): SkinStation[] {
  return [
    { y: 0.845, rx: 0.133, rz: 0.096, z: -0.004, power: 2.3, weights: W({ pelvis: 1 }) },
    { y: 0.878, rx: 0.151, rz: 0.109, z: -0.007, power: 2.3, weights: W({ pelvis: 1 }) },
    { y: 0.918, rx: 0.159, rz: 0.115, z: -0.005, power: 2.3, weights: W({ pelvis: 1 }) },
    { y: 0.958, rx: 0.156, rz: 0.111, z: -0.001, power: 2.2, weights: W({ pelvis: 0.85, spine: 0.15 }) },
    { y: 1.0, rx: 0.148, rz: 0.105, z: 0.002, power: 2.2, weights: W({ pelvis: 0.45, spine: 0.55 }) },
    { y: 1.042, rx: 0.141, rz: 0.1, z: 0.005, power: 2.2, weights: W({ spine: 1 }) },
    { y: 1.082, rx: 0.139, rz: 0.099, z: 0.006, power: 2.2, weights: W({ spine: 0.86, chest: 0.14 }) },
    { y: 1.112, rx: 0.143, rz: 0.102, z: 0.005, power: 2.2, weights: W({ spine: 0.64, chest: 0.36 }) },
    { y: 1.142, rx: 0.148, rz: 0.105, z: 0.005, power: 2.2, weights: W({ spine: 0.4, chest: 0.6 }) },
    { y: 1.168, rx: 0.154, rz: 0.109, z: 0.004, power: 2.3, weights: W({ spine: 0.18, chest: 0.82 }) },
    { y: 1.196, rx: 0.159, rz: 0.112, z: 0.004, power: 2.3, weights: W({ chest: 1 }) },
    { y: 1.236, rx: 0.164, rz: 0.115, z: 0.003, power: 2.4, weights: W({ chest: 1 }) },
    { y: 1.286, rx: 0.17, rz: 0.114, z: 0.002, power: 2.4, weights: W({ chest: 1 }) },
    { y: 1.336, rx: 0.175, rz: 0.11, z: 0, power: 2.4, weights: W({ chest: 1 }) },
    { y: 1.375, rx: 0.176, rz: 0.104, z: -0.002, power: 2.3, weights: W({ chest: 1 }) },
    { y: 1.402, rx: 0.174, rz: 0.098, z: -0.004, power: 2.2, weights: W({ chest: 1 }) },
    { y: 1.424, rx: 0.16, rz: 0.09, z: -0.005, weights: W({ chest: 1 }) },
    { y: 1.444, rx: 0.118, rz: 0.081, z: -0.005, weights: W({ chest: 0.75, neck: 0.25 }) },
    { y: 1.462, rx: 0.078, rz: 0.07, z: -0.003, weights: W({ chest: 0.35, neck: 0.65 }) },
  ];
}

// ----------------------------------------------------------------------- neck
// The neck is a skin part: it has to disappear into the jaw above and the
// collar below without a visible seam.
function neckStations(): SkinStation[] {
  return [
    { y: 1.415, rx: 0.063, rz: 0.06, z: 0.002, weights: W({ chest: 0.85, neck: 0.15 }) },
    { y: 1.448, rx: 0.057, rz: 0.055, z: 0.004, weights: W({ neck: 1 }) },
    { y: 1.482, rx: 0.053, rz: 0.052, z: 0.006, weights: W({ neck: 0.8, head: 0.2 }) },
    { y: 1.516, rx: 0.054, rz: 0.054, z: 0.008, weights: W({ neck: 0.35, head: 0.65 }) },
    { y: 1.55, rx: 0.059, rz: 0.058, z: 0.008, weights: W({ head: 1 }) },
  ];
}

// ----------------------------------------------------------------------- arms
// From inside the chest, over the deltoid cap, down the biceps and triceps,
// across the elbow, over the forearm flexors and into the wrist. The top ring
// is buried in the trunk, so there is no shoulder seam to see.
function armStations(side: 1 | -1): SkinStation[] {
  const x = side * 0.2;
  const wUpper = (amount: number): Partial<Record<SkinWeightBone, number>> =>
    W({ chest: 1 - amount, upperArm: amount });
  const wFore = (amount: number): Partial<Record<SkinWeightBone, number>> =>
    W({ upperArm: 1 - amount, foreArm: amount });
  return [
    { y: 0.888, x, rx: 0.025, rz: 0.027, weights: W({ foreArm: 1 }) },
    { y: 0.908, x, rx: 0.027, rz: 0.029, weights: W({ foreArm: 1 }) },
    { y: 0.952, x, rx: 0.033, rz: 0.034, weights: W({ foreArm: 1 }) },
    { y: 0.996, x, rx: 0.039, rz: 0.039, weights: W({ foreArm: 1 }) },
    { y: 1.04, x, rx: 0.043, rz: 0.042, weights: W({ foreArm: 1 }) },
    { y: 1.078, x, rx: 0.045, rz: 0.043, weights: W({ foreArm: 1 }) },
    // The elbow carries a little extra width over the condyles; without it the
    // sleeve pinches to a waist at full flexion.
    { y: 1.104, x, rx: 0.047, rz: 0.046, weights: wFore(0.12) },
    { y: 1.126, x, rx: 0.047, rz: 0.046, weights: wFore(0.34) },
    { y: 1.148, x, rx: 0.047, rz: 0.046, weights: wFore(0.5) },
    { y: 1.17, x, rx: 0.047, rz: 0.046, weights: wFore(0.72) },
    { y: 1.192, x, rx: 0.047, rz: 0.047, weights: wFore(0.92) },
    { y: 1.214, x, rx: 0.049, rz: 0.049, z: 0.002, weights: W({ upperArm: 1 }) },
    { y: 1.258, x, rx: 0.049, rz: 0.05, z: 0.003, weights: W({ upperArm: 1 }) },
    { y: 1.302, x, rx: 0.05, rz: 0.051, z: 0.002, weights: W({ upperArm: 1 }) },
    { y: 1.346, x, rx: 0.053, rz: 0.054, z: 0.001, weights: W({ upperArm: 1 }) },
    // The deltoid is a mass, not a tube end. It stays with the arm as the arm
    // elevates, so the sleeve turns over the joint instead of being left behind
    // as a wedge of cloth; the clavicle takes a share at the top so the girdle
    // still carries the shoulder.
    { y: 1.374, x: side * 0.199, rx: 0.057, rz: 0.058, weights: W({ upperArm: 0.95, clav: 0.05 }) },
    { y: 1.396, x: side * 0.194, rx: 0.06, rz: 0.061, weights: W({ upperArm: 0.85, clav: 0.15 }) },
    { y: 1.416, x: side * 0.184, rx: 0.058, rz: 0.059, weights: W({ upperArm: 0.7, clav: 0.3 }) },
    { y: 1.431, x: side * 0.17, rx: 0.05, rz: 0.052, weights: W({ upperArm: 0.55, clav: 0.45 }) },
    { y: 1.442, x: side * 0.158, rx: 0.038, rz: 0.04, weights: W({ upperArm: 0.4, clav: 0.6 }) },
    { y: 1.45, x: side * 0.15, rx: 0.019, rz: 0.021, weights: W({ upperArm: 0.3, clav: 0.7 }) },
  ];
}

// ----------------------------------------------------------------------- legs
// The thigh starts inside the pelvis so the hip joint is covered, keeps a
// quadriceps bulge in front, narrows at the knee, then opens into the calf
// behind the shank and tapers to the ankle inside the boot.
function legStations(side: 1 | -1): SkinStation[] {
  const x = side * 0.097;
  const wThigh = (amount: number): Partial<Record<SkinWeightBone, number>> =>
    W({ pelvis: 1 - amount, thigh: amount });
  const wShin = (amount: number): Partial<Record<SkinWeightBone, number>> =>
    W({ thigh: 1 - amount, shin: amount });
  return [
    { y: 0.05, x, rx: 0.033, rz: 0.036, weights: W({ shin: 1 }) },
    { y: 0.078, x, rx: 0.035, rz: 0.038, weights: W({ shin: 1 }) },
    { y: 0.13, x, rx: 0.038, rz: 0.04, weights: W({ shin: 1 }) },
    { y: 0.2, x, rx: 0.044, rz: 0.045, weights: W({ shin: 1 }) },
    { y: 0.267, x, rx: 0.052, rz: 0.053, weights: W({ shin: 1 }) },
    { y: 0.327, x, rx: 0.06, rz: 0.062, z: -0.004, weights: W({ shin: 1 }) },
    { y: 0.378, x, rx: 0.064, rz: 0.068, z: -0.006, weights: W({ shin: 1 }) },
    { y: 0.418, x, rx: 0.058, rz: 0.062, z: -0.002, weights: W({ shin: 1 }) },
    // Trousers over the knee: a little wider over the patella, and the weights
    // handed over across four rings so a 120-degree bend folds instead of
    // creasing to a point.
    { y: 0.444, x, rx: 0.057, rz: 0.06, weights: wShin(0.92) },
    { y: 0.466, x, rx: 0.058, rz: 0.062, z: 0.002, weights: wShin(0.72) },
    { y: 0.49, x, rx: 0.061, rz: 0.064, z: 0.003, weights: wShin(0.5) },
    { y: 0.514, x, rx: 0.06, rz: 0.063, z: 0.002, weights: wShin(0.28) },
    { y: 0.538, x, rx: 0.059, rz: 0.062, weights: wShin(0.08) },
    { y: 0.57, x, rx: 0.063, rz: 0.066, weights: W({ thigh: 1 }) },
    { y: 0.62, x, rx: 0.069, rz: 0.072, weights: W({ thigh: 1 }) },
    { y: 0.7, x, rx: 0.077, rz: 0.079, z: 0.003, weights: W({ thigh: 1 }) },
    { y: 0.78, x, rx: 0.084, rz: 0.085, z: 0.004, weights: W({ thigh: 1 }) },
    { y: 0.85, x, rx: 0.089, rz: 0.09, z: 0.002, weights: W({ thigh: 1 }) },
    // The hip socket: five rings of hand-over so a 90-degree hip flexion folds
    // at the groin instead of hinging a tube.
    { y: 0.886, x, rx: 0.091, rz: 0.093, weights: wThigh(0.92) },
    { y: 0.912, x, rx: 0.093, rz: 0.095, weights: wThigh(0.74) },
    { y: 0.938, x, rx: 0.094, rz: 0.096, weights: wThigh(0.52) },
    { y: 0.964, x: side * 0.093, rx: 0.092, rz: 0.095, weights: wThigh(0.3) },
    { y: 0.986, x: side * 0.09, rx: 0.089, rz: 0.093, weights: wThigh(0.1) },
    { y: 1.008, x: side * 0.088, rx: 0.086, rz: 0.09, weights: W({ pelvis: 1 }) },
  ];
}

export function skinParts(): SkinPart[] {
  return [
    { name: 'trunk', material: 'tunic', stations: trunkStations() },
    { name: 'arm.L', material: 'tunic', stations: armStations(1), side: 'L' },
    { name: 'arm.R', material: 'tunic', stations: armStations(-1), side: 'R' },
    { name: 'neck', material: 'skin', stations: neckStations() },
    { name: 'leg.L', material: 'trousers', stations: legStations(1), side: 'L' },
    { name: 'leg.R', material: 'trousers', stations: legStations(-1), side: 'R' },
  ];
}

// ---------------------------------------------------------------- geometry
function buildPartGeometry(
  part: SkinPart,
  boneIndex: Record<SkinBoneName, number>,
  segments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  const resolve = (name: SkinWeightBone): SkinBoneName =>
    part.side && SIDED.includes(name)
      ? (`${name}.${part.side}` as SkinBoneName)
      : (name as SkinBoneName);

  const pushWeights = (weights: Partial<Record<SkinWeightBone, number>>) => {
    const entries = (Object.entries(weights) as [SkinWeightBone, number][]).map(
      ([name, value]) => [resolve(name), value] as [SkinBoneName, number],
    );
    const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
    for (let slot = 0; slot < 4; slot += 1) {
      const entry = entries[slot];
      skinIndices.push(entry ? boneIndex[entry[0]] : 0);
      skinWeights.push(entry ? entry[1] / total : 0);
    }
  };

  const rings = part.stations.length;
  for (const station of part.stations) {
    const cx = station.x ?? 0;
    const cz = station.z ?? 0;
    const power = station.power ?? 2;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / power) * station.rx;
      const pz = Math.sign(s) * Math.pow(Math.abs(s), 2 / power) * station.rz;
      positions.push(cx + px, station.y, cz + pz);
      pushWeights(station.weights);
    }
  }

  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = ring * segments + i;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + i;
      const d = (ring + 1) * segments + next;
      // Outward winding for a loft running upward with +X/+Z sections.
      indices.push(a, c, b, b, c, d);
    }
  }

  // Caps. Their centres sit on the axis and carry the end ring's weights, so a
  // cap deforms with the section it closes. Both ends are buried in another
  // part of the body, so the caps only exist to keep the surface closed.
  const cap = (station: SkinStation, atTop: boolean) => {
    const center = positions.length / 3;
    positions.push(station.x ?? 0, station.y, station.z ?? 0);
    pushWeights(station.weights);
    const ringStart = atTop ? (rings - 1) * segments : 0;
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = ringStart + i;
      const b = ringStart + next;
      if (atTop) indices.push(center, a, b);
      else indices.push(center, b, a);
    }
  };
  cap(part.stations[0], false);
  cap(part.stations[rings - 1], true);

  const geometry = new THREE.BufferGeometry();
  // Ring layout for deformation checks: the loft is rings × segments, then two
  // cap vertices. A ring is the cross-section that pinches when the blend is
  // wrong, so the check measures its perimeter.
  geometry.userData.rings = rings;
  geometry.userData.segments = segments;
  geometry.userData.loft = rings * segments;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Tangent-free standard material; UVs are not needed for flat uniform cloth.
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  return geometry;
}

export interface SkinMaterials {
  tunic: THREE.Material;
  trousers: THREE.Material;
  skin: THREE.Material;
}

/**
 * Build and bind the body surface. `bones` must already be in their rest pose
 * and parented into the figure, because a skin's inverse bind matrices are
 * captured from the world transform at bind time.
 */
export function buildSkin(
  bones: Record<SkinBoneName, THREE.Bone>,
  materials: SkinMaterials,
  detail: 'low' | 'high',
): SkinBuild {
  const segments = detail === 'high' ? 28 : 18;
  const boneIndex = {} as Record<SkinBoneName, number>;
  SKIN_BONES.forEach((name, index) => {
    boneIndex[name] = index;
  });

  // Dual-quaternion blend: linear blending scaled a ring down at a bent joint
  // (cosine of half the joint angle), which is what pinched the shoulder and
  // the hip. Blending the rigid transform instead keeps the ring's shape.
  useDualQuaternionSkinning(materials.tunic);
  useDualQuaternionSkinning(materials.trousers);
  useDualQuaternionSkinning(materials.skin);

  const parts = skinParts();
  const skeleton = new THREE.Skeleton(SKIN_BONES.map((name) => bones[name]));
  const meshes: THREE.SkinnedMesh[] = [];
  for (const part of parts) {
    const geometry = buildPartGeometry(part, boneIndex, segments);
    const mesh = new THREE.SkinnedMesh(geometry, materials[part.material]);
    mesh.name = `skin:${part.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A skinned mesh's bounds are the rest pose; a lifted arm leaves them.
    mesh.frustumCulled = false;
    mesh.bind(skeleton);
    meshes.push(mesh);
  }
  return { meshes, skeleton, parts };
}

/** Cross-section radius of a named part at a height, for tests and fitting. */
export function skinRadiusAt(part: SkinPart, y: number): number | null {
  for (let i = 1; i < part.stations.length; i += 1) {
    const a = part.stations[i - 1];
    const b = part.stations[i];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1);
      return a.rx + (b.rx - a.rx) * t;
    }
  }
  return null;
}
