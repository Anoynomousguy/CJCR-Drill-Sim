// Chest-space pose model: posture hands, rifle and colour frames, gait angles.
//
// Every target in this module is expressed in CHEST SPACE: the origin is the
// chest joint (1.16 m above the parade square on the 1.78 m reference body),
// +Y is up, +Z is the way the cadet faces and +X is the cadet's left. The arm
// chain in figure.ts uses the same origin, so a hand target needs no fudge
// factor and a grip point is exactly where the hand is placed.
//
// A carried rifle is not attached to a hand. It is a rigid frame — a butt
// position plus an axis — and the hands are placed on named points along that
// axis. That is what lets the rifle rest in the hollow of the shoulder at the
// slope while the hands still hold it at the order, the present and the port.

import { GAIT_ANATOMY, JOINT_LIMITS, clampJoint, type JointName } from './anatomy';
import type { ColourState, Gait, Posture, Snapshot, WeaponState } from './types';

export type Vec3 = [number, number, number];
export type Rot = [number, number, number];

/** Skeletal landmarks and segment lengths, metres, for the 1.78 m reference body. */
export const BODY = {
  height: 1.78,
  hip: 0.92,
  spine: 0.07,
  chest: 0.17,
  /** Spine + chest: the chest joint sits this far above the pelvis. */
  chestOrigin: 0.24,
  neck: 0.31,
  head: 0.06,
  shoulderX: 0.2,
  shoulderY: 0.24,
  femur: 0.45,
  tibia: 0.42,
  humerus: 0.27,
  forearm: 0.245,
} as const;

/** Chest-space height of the parade square for a cadet standing at attention. */
export const GROUND_Y = -(BODY.hip + BODY.chestOrigin);

/** Metres of travel per stride used by the gait phase (three paces). */
export const STRIDE_LENGTH = 1.5;

const RAD = Math.PI / 180;
export const toRad = (deg: number) => deg * RAD;
export const toDeg = (rad: number) => rad / RAD;

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Shortest and longest shoulder-to-wrist distances that stay inside the joint limits. */
export const ARM_MAX_REACH = BODY.humerus + BODY.forearm - 0.005;
export const ARM_MIN_REACH = Math.sqrt(
  BODY.humerus ** 2 +
    BODY.forearm ** 2 -
    2 * BODY.humerus * BODY.forearm * Math.cos(Math.PI - 145 * RAD),
);

/** Shoulder-to-wrist distance that produces a given elbow flexion. */
export function distanceForElbow(flexDeg: number): number {
  const flex = clampJoint('elbowFlexion', flexDeg) * RAD;
  return Math.sqrt(BODY.humerus ** 2 + BODY.forearm ** 2 + 2 * BODY.humerus * BODY.forearm * Math.cos(flex));
}

/**
 * Move a hanging hand through a shoulder swing of `flexDeg` (forward positive)
 * and set the reach so the elbow sits at `elbowDeg`. X is left alone, so the
 * arm keeps its interval from the body.
 */
export function swingHand(rest: Vec3, flexDeg: number, elbowDeg: number): Vec3 {
  const flex = clampJoint('shoulderFlexion', flexDeg) * RAD;
  const reach = distanceForElbow(elbowDeg);
  // Keep the hand's interval from the body, and take the reach out of the
  // vertical and forward components so the wrist lands exactly at `reach`.
  const side = rest[0] >= 0 ? 1 : -1;
  const dx = rest[0] - side * BODY.shoulderX;
  const planar = Math.sqrt(Math.max(1e-4, reach * reach - dx * dx));
  return [rest[0], BODY.shoulderY - Math.cos(flex) * planar, Math.sin(flex) * planar];
}

export const shoulderOf = (side: 1 | -1): Vec3 => [side * BODY.shoulderX, BODY.shoulderY, 0];

// ===================================================================== hands
// Hands at the halt, in chest space. The arm hangs about 0.49 m below the
// shoulder, which is where a 51.5 cm arm reaches with the elbow just off lock.
export const POSTURE_HANDS: Record<Posture, { left: Vec3; right: Vec3; torso?: Rot }> = {
  attention: { left: [0.225, -0.25, 0.02], right: [-0.225, -0.25, 0.02] },
  standAtEase: { left: [0.055, -0.02, -0.17], right: [-0.055, -0.02, -0.17] },
  standEasy: { left: [0.1, -0.06, -0.16], right: [-0.1, -0.06, -0.16], torso: [2, 0, 0] },
  // Right fingertips at the right eyebrow: 1.66 m up, 0.31 m from the shoulder.
  salute: { left: [0.225, -0.25, 0.02], right: [-0.07, 0.5, 0.1] },
};

/** RIGHT DRESS: arm horizontal at shoulder height, palm down. */
export const DRESS_HANDS: { left: Vec3; right: Vec3 } = {
  left: [0.225, -0.25, 0.02],
  right: [-0.68, 0.26, 0.03],
};

// ===================================================================== rifle
export const RIFLE = {
  /** Lee-Enfield No. 1 Mk III: 1.13 m overall. */
  length: 1.13,
  /** Distance from the butt to each grip. */
  grip: { small: 0.12, balance: 0.52, order: 0.9 },
} as const;

/**
 * A carriage is a butt position plus the direction of the barrel, both in
 * chest space, and the grip offset (metres from the butt) taken by each hand.
 * A hand that is not listed stays free.
 */
export interface Carriage {
  butt: Vec3;
  /** Butt → muzzle, not necessarily unit length; normalised on use. */
  dir: Vec3;
  /** Rotation about the rifle axis, degrees; 0 has the bolt handle on the right. */
  roll?: number;
  hands: { left?: number; right?: number };
}

export function carriageDir(c: Carriage): Vec3 {
  return normalize(c.dir);
}

export function carriagePoint(c: Carriage, along: number): Vec3 {
  const d = carriageDir(c);
  return [c.butt[0] + d[0] * along, c.butt[1] + d[1] * along, c.butt[2] + d[2] * along];
}

const RIFLE_ORDER: Carriage = {
  // Butt on the square beside the right boot, rifle upright, right hand at the
  // upper band — the point the straight arm naturally reaches (0.90 m up).
  butt: [-0.235, GROUND_Y, 0.06],
  dir: [0, 1, 0],
  hands: { right: RIFLE.grip.order },
};

const RIFLE_SLOPE: Carriage = {
  // Butt at the left hip, barrel through the hollow of the left shoulder at
  // 1.40 m, muzzle up and 25 cm behind the shoulder. Left hand at the small.
  butt: [0.17, -0.2, 0.1],
  dir: [0.02, 0.95, -0.31],
  roll: 12,
  hands: { left: RIFLE.grip.small },
};

const RIFLE_PRESENT: Carriage = {
  // Vertical in front of the centre of the body, butt at hip height, left hand
  // at the balance above the right hand at the small of the butt.
  butt: [-0.03, -0.22, 0.24],
  dir: [0.02, 0.999, 0.04],
  hands: { left: RIFLE.grip.balance, right: 0.13 },
};

const RIFLE_PORT: Carriage = {
  // Diagonal across the chest, muzzle up and left of the left shoulder, butt
  // down by the right hip.
  butt: [-0.15, -0.2, 0.22],
  dir: [0.46, 0.86, 0.12],
  roll: 8,
  hands: { left: RIFLE.grip.balance, right: 0.13 },
};

export const RIFLE_CARRIAGE: Record<Exclude<WeaponState, 'none'>, Carriage> = {
  order: RIFLE_ORDER,
  slope: RIFLE_SLOPE,
  present: RIFLE_PRESENT,
  port: RIFLE_PORT,
  inspection: {
    butt: [-0.1, -0.1, 0.26],
    dir: [0.3, 0.94, 0.16],
    roll: 8,
    hands: { left: 0.55, right: 0.16 },
  },
  trail: {
    // Muzzle down and forward at the trail, hand at the balance.
    butt: [-0.24, 0.2325, -0.203],
    dir: [0, -0.75, 0.66],
    roll: 90,
    hands: { right: RIFLE.grip.balance },
  },
  grounded: {
    // Lying flat on the square beside the right boot.
    butt: [-0.25, GROUND_Y + 0.045, -0.3],
    dir: [0, 0, 1],
    roll: 90,
    hands: {},
  },
  reversed: {
    // Reversed, butt up beside the right shoulder, muzzle down at the boot.
    butt: [-0.23, 0.52, 0.16],
    dir: [0, -0.999, 0.03],
    hands: { right: RIFLE.grip.balance },
  },
  sling: {
    // Slung over the right shoulder, muzzle up behind.
    butt: [0.1, -0.3, -0.05],
    dir: [-0.25, 0.95, -0.18],
    roll: 100,
    hands: {},
  },
};

// ==================================================================== colour
export const PIKE = {
  length: 2.15,
  flagAt: 1.85,
} as const;

export const COLOUR_CARRIAGE: Record<Exclude<ColourState, 'none'>, Carriage> = {
  order: { butt: [-0.24, GROUND_Y, 0.12], dir: [0, 1, 0], hands: { right: 0.95 } },
  carry: { butt: [-0.2, -0.45, 0.14], dir: [0, 1, 0], hands: { right: 0.35 } },
  slope: {
    // Diagonal across the front, both grips below shoulder height.
    butt: [-0.14, -0.35, 0.22],
    dir: [0.4, 0.9, 0.17],
    hands: { right: 0.3, left: 0.65 },
  },
  dip: { butt: [-0.14, -0.2, 0.05], dir: [0, 0.707, 0.707], hands: { right: 0.55 } },
  letFly: { butt: [-0.19, -0.55, 0.28], dir: [0.02, 0.9998, 0.02], hands: { right: 1 } },
};

// ===================================================================== poses
export interface PoseTargets {
  handL: Vec3;
  handR: Vec3;
  torso: Rot;
  weapon: Carriage | null;
  colour: Carriage | null;
}

/** Resolve one drill snapshot into hand targets, a rifle frame and a pike frame. */
export function poseTargets(snapshot: Snapshot, hasRifle: boolean, hasColour: boolean): PoseTargets {
  const posture = POSTURE_HANDS[snapshot.posture] ?? POSTURE_HANDS.attention;
  let weapon: Carriage | null = null;
  let colour: Carriage | null = null;
  if (hasColour && snapshot.colour !== 'none') colour = COLOUR_CARRIAGE[snapshot.colour as Exclude<ColourState, 'none'>] ?? null;
  else if (hasRifle && snapshot.weapon !== 'none') weapon = RIFLE_CARRIAGE[snapshot.weapon as Exclude<WeaponState, 'none'>] ?? null;
  const carrier = weapon ?? colour;
  const grip = (side: 'left' | 'right', fallback: Vec3): Vec3 => {
    const along = side === 'left' ? carrier?.hands.left : carrier?.hands.right;
    return carrier && along !== undefined ? carriagePoint(carrier, along) : fallback;
  };
  return {
    handL: grip('left', posture.left),
    handR: grip('right', posture.right),
    torso: posture.torso ?? [0, 0, 0],
    weapon,
    colour,
  };
}

/** True when that hand is holding the rifle or the pike in this target. */
export function handIsGripping(targets: PoseTargets, side: 'L' | 'R'): boolean {
  const carrier = targets.weapon ?? targets.colour;
  if (!carrier) return false;
  return (side === 'L' ? carrier.hands.left : carrier.hands.right) !== undefined;
}

/** Blend two carriage frames; a missing frame leaves the other one alone. */
export function mixCarriage(a: Carriage | null, b: Carriage | null, u: number): Carriage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    butt: lerpV(a.butt, b.butt, u),
    dir: normalize(lerpV(normalize(a.dir), normalize(b.dir), u)),
    roll: lerp(a.roll ?? 0, b.roll ?? 0, u),
    hands: {},
  };
}

// ====================================================================== gait
export interface GaitPose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
  trunk: number;
  shoulderSwing: number;
  elbow: number;
}

/**
 * Joint angles for one instant of a gait. The leading leg is the left at
 * phase π/2, and at that instant it sits exactly on the manual's targets:
 * 28° hip / 4° knee / 18° ankle for quick march, 45 / 95 / 10 for double,
 * 90 / 90 / 12 for mark time. The trailing leg takes the recovery values from
 * GAIT_ANATOMY (`hipBack`, `kneeBack`) at phase 3π/2. Everything is clamped to
 * the joint's active range before it is returned.
 */
export function gaitPose(gait: Gait, phase: number): GaitPose {
  const g = GAIT_ANATOMY[gait] ?? GAIT_ANATOMY.halt;
  const s = Math.sin(phase);
  const leg = (f: number) => {
    const forward = Math.max(0, f);
    const hip = clampJoint('hipFlexion', f >= 0 ? g.hip * f : g.hipBack * f);
    const knee = clampJoint('kneeFlexion', g.knee * forward + g.kneeBack * Math.max(0, -f));
    const ankle = clampJoint('anklePlantar', g.ankle * (0.7 + 0.3 * forward));
    return { hip, knee, ankle };
  };
  const left = leg(s);
  const right = leg(-s);
  return {
    hipL: left.hip,
    hipR: right.hip,
    kneeL: left.knee,
    kneeR: right.knee,
    ankleL: left.ankle,
    ankleR: right.ankle,
    trunk: g.trunk,
    shoulderSwing: g.shoulderSwing,
    elbow: g.elbow,
  };
}

/** Phase at which the left leg is at the top of its swing. */
export const PEAK_PHASE = Math.PI / 2;

export interface GaitAudit {
  gait: Gait;
  target: { hip: number; knee: number; ankle: number };
  model: { hip: number; knee: number; ankle: number };
  onTarget: boolean;
  withinLimits: boolean;
}

export interface AuditResult {
  gaits: GaitAudit[];
  samples: number;
  limitBreaches: number;
  onTarget: number;
}

/**
 * Numeric self-check of the gait model: the peak of the swing against the
 * manual target, and every sampled angle against the joint's range of motion.
 */
export function auditGaits(samples = 240): AuditResult {
  const gaits: GaitAudit[] = [];
  let limitBreaches = 0;
  let onTarget = 0;
  for (const gait of Object.keys(GAIT_ANATOMY) as Gait[]) {
    const g = GAIT_ANATOMY[gait];
    const peak = gaitPose(gait, PEAK_PHASE);
    let withinLimits = true;
    for (let i = 0; i < samples; i += 1) {
      const p = gaitPose(gait, (i / samples) * Math.PI * 2);
      const pairs: [JointName, number][] = [
        ['hipFlexion', p.hipL],
        ['hipFlexion', p.hipR],
        ['kneeFlexion', p.kneeL],
        ['kneeFlexion', p.kneeR],
        ['anklePlantar', p.ankleL],
        ['anklePlantar', p.ankleR],
      ];
      for (const [joint, value] of pairs) {
        const limit = JOINT_LIMITS[joint];
        if (value < limit.min - 1e-9 || value > limit.max + 1e-9) {
          withinLimits = false;
          limitBreaches += 1;
        }
      }
    }
    // The values are integers once read off the rig; compare at that resolution.
    const at = (a: number, b: number) => Math.round(a) === Math.round(b);
    const onTargetNow =
      at(peak.hipL, g.hip) && at(peak.kneeL, g.knee) && at(peak.ankleL, g.ankle);
    if (onTargetNow) onTarget += 1;
    gaits.push({
      gait,
      target: { hip: g.hip, knee: g.knee, ankle: g.ankle },
      model: { hip: peak.hipL, knee: peak.kneeL, ankle: peak.ankleL },
      onTarget: onTargetNow,
      withinLimits,
    });
  }
  return { gaits, samples, limitBreaches, onTarget };
}
