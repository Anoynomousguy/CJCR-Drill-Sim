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
    { y: 1.088, rx: 0.139, rz: 0.099, z: 0.006, power: 2.2, weights: W({ spine: 0.8, chest: 0.2 }) },
    { y: 1.136, rx: 0.146, rz: 0.104, z: 0.005, power: 2.2, weights: W({ spine: 0.35, chest: 0.65 }) },
    { y: 1.186, rx: 0.156, rz: 0.111, z: 0.004, power: 2.3, weights: W({ chest: 1 }) },
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
    { y: 1.083, x, rx: 0.045, rz: 0.043, weights: W({ foreArm: 1 }) },
    { y: 1.113, x, rx: 0.043, rz: 0.042, weights: wFore(0.15) },
    { y: 1.14, x, rx: 0.042, rz: 0.042, weights: wFore(0.5) },
    { y: 1.167, x, rx: 0.043, rz: 0.044, weights: wFore(0.85) },
    { y: 1.205, x, rx: 0.046, rz: 0.047, z: 0.002, weights: W({ upperArm: 1 }) },
    { y: 1.255, x, rx: 0.049, rz: 0.05, z: 0.003, weights: W({ upperArm: 1 }) },
    { y: 1.305, x, rx: 0.05, rz: 0.051, z: 0.002, weights: W({ upperArm: 1 }) },
    { y: 1.355, x, rx: 0.05, rz: 0.051, z: 0.001, weights: W({ upperArm: 1 }) },
    { y: 1.395, x: side * 0.196, rx: 0.052, rz: 0.054, weights: W({ upperArm: 0.85, chest: 0.15 }) },
    { y: 1.418, x: side * 0.188, rx: 0.053, rz: 0.055, weights: wUpper(0.7) },
    { y: 1.436, x: side * 0.172, rx: 0.046, rz: 0.049, weights: wUpper(0.35) },
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
    { y: 0.452, x, rx: 0.056, rz: 0.059, weights: wShin(0.85) },
    { y: 0.48, x, rx: 0.056, rz: 0.059, weights: wShin(0.5) },
    { y: 0.507, x, rx: 0.058, rz: 0.061, weights: wShin(0.15) },
    { y: 0.55, x, rx: 0.062, rz: 0.065, weights: W({ thigh: 1 }) },
    { y: 0.62, x, rx: 0.069, rz: 0.072, weights: W({ thigh: 1 }) },
    { y: 0.7, x, rx: 0.077, rz: 0.079, z: 0.003, weights: W({ thigh: 1 }) },
    { y: 0.78, x, rx: 0.084, rz: 0.085, z: 0.004, weights: W({ thigh: 1 }) },
    { y: 0.85, x, rx: 0.089, rz: 0.09, z: 0.002, weights: W({ thigh: 1 }) },
    { y: 0.9, x, rx: 0.092, rz: 0.093, weights: wThigh(0.85) },
    { y: 0.93, x, rx: 0.094, rz: 0.096, weights: wThigh(0.6) },
    { y: 0.965, x: side * 0.093, rx: 0.092, rz: 0.095, weights: wThigh(0.35) },
    { y: 1.0, x: side * 0.09, rx: 0.088, rz: 0.092, weights: W({ pelvis: 1 }) },
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
