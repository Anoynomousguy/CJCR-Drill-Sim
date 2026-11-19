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

import { clampJoint } from './anatomy';
import type { ColourState, Posture, Snapshot, WeaponState } from './types';
import { smoothstep } from './util';

export type Vec3 = [number, number, number];
export type Rot = [number, number, number];

/** Skeletal landmarks and segment lengths, metres, for the 1.78 m reference body. */
export const BODY = {
  height: 1.78,
  hip: 0.93,
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
  // SALUTE (Ch 2, paras 37-38): palm down, fingers extended, the tip of the
  // second finger on the lower edge of the headdress in line with the outside
  // of the right eyebrow, and the upper arm parallel to the ground. The target
  // is the WRIST: the straight hand reaches a further 0.16 m, so the old wrist
  // at the eyebrow itself put the fingers into the beret and forced the elbow
  // 0.19 m above the shoulder to get there.
  salute: { left: [0.225, -0.25, 0.02], right: [-0.141, 0.445, 0.155] },
};

/** Wrist-to-second-fingertip reach of the straight hand, metres. */
export const HAND_REACH = 0.16;

/**
 * The salute at the halt is two numbered movements (Ch 2, paras 37-38): ONE
 * carries the hand to the headdress in one beat, the standard pause holds it
 * for two beats, and TWO cuts it away in one. As fractions of the movement:
 * 0.25 + 0.50 + 0.25 of 2 s = 0.5 s + 1.0 s + 0.5 s.
 */
export const SALUTE_RAISE = 0.25;
export const SALUTE_CUT = 0.75;

/** 0 at attention, 1 with the hand at the headdress; the raise and the cut. */
export function saluteArmAt(raw: number): number {
  const t = clamp01(raw);
  if (t < SALUTE_RAISE) return smoothstep(t / SALUTE_RAISE);
  if (t <= SALUTE_CUT) return 1;
  return 1 - smoothstep((t - SALUTE_CUT) / (1 - SALUTE_CUT));
}

/**
 * SALUTE ON THE MARCH WITHOUT ARMS (Ch 3). The command is given on the left
 * foot; the counts are CHECK – UP – TWO – THREE – FOUR – FIVE – DOWN – SWING,
 * one footfall each, and the squad covers a pace per count. The right arm comes
 * up with the left foot on UP, is held through FIVE, is cut as the right foot
 * lands on DOWN, and the arms swing again from SWING on the left.
 *
 * A march segment's plants sit half a beat inside its ends (the seam between
 * two marches falls half a beat after the last plant), so the eight footfalls
 * are at 0.5 … 7.5 of the eight beats.
 */
export const MARCH_SALUTE_UP = 1.5 / 8;
export const MARCH_SALUTE_CUT = 5.5 / 8;
export const MARCH_SALUTE_DOWN = 6.5 / 8;
const MARCH_SALUTE_CHECK = 0.5 / 8;
/** The SWING left footfall: the head is back to the front by then. */
export const MARCH_SALUTE_SWING = 7.5 / 8;

export function marchSaluteAt(raw: number): number {
  const t = clamp01(raw);
  if (t <= MARCH_SALUTE_CHECK) return 0;
  if (t < MARCH_SALUTE_UP) {
    return smoothstep((t - MARCH_SALUTE_CHECK) / (MARCH_SALUTE_UP - MARCH_SALUTE_CHECK));
  }
  if (t <= MARCH_SALUTE_CUT) return 1;
  if (t < MARCH_SALUTE_DOWN) {
    return 1 - smoothstep((t - MARCH_SALUTE_CUT) / (MARCH_SALUTE_DOWN - MARCH_SALUTE_CUT));
  }
  return 0;
}

/**
 * The head turns right on the UP left footfall and is held while saluting (Ch
 * 3: "while saluting, the head is turned right"). The salute completes with the
 * arm cut on DOWN, a right foot; the head cuts back to the front on the next
 * left foot (SWING), the same way EYES FRONT cuts it on a left footfall. The
 * salute is then self-contained: no EYES FRONT is needed to finish it.
 */
export function marchSaluteEyesAt(raw: number): number {
  const t = clamp01(raw);
  if (t < MARCH_SALUTE_UP) return 0;
  if (t <= MARCH_SALUTE_DOWN) return 1;
  if (t < MARCH_SALUTE_SWING) {
    return 1 - smoothstep((t - MARCH_SALUTE_DOWN) / (MARCH_SALUTE_SWING - MARCH_SALUTE_DOWN));
  }
  return 0;
}

/**
 * The elbow of the armed salute. 54-04 para 90 puts the right forearm
 * horizontal while the hand strikes the small of the butt, so the elbow sits
 * on the horizontal plane through the wrist. Of the two intersections of that
 * plane with the two-bone chain the salute takes the one in front of the
 * chest, clear of the tunic.
 */
export function levelForearmElbow(shoulder: Vec3, wrist: Vec3): Vec3 | null {
  const level = wrist[1];
  const drop = shoulder[1] - level;
  if (Math.abs(drop) >= BODY.humerus) return null;
  const r1 = Math.sqrt(BODY.humerus ** 2 - drop * drop);
  const r2 = BODY.forearm;
  const dx = wrist[0] - shoulder[0];
  const dz = wrist[2] - shoulder[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const across = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const ux = dx / d;
  const uz = dz / d;
  const bx = shoulder[0] + ux * along;
  const bz = shoulder[2] + uz * along;
  const forwardX = bx - uz * across;
  const forwardZ = bz + ux * across;
  const backX = bx + uz * across;
  const backZ = bz - ux * across;
  return forwardZ >= backZ ? [forwardX, level, forwardZ] : [backX, level, backZ];
}

/** The tunic front, chest space: a joint at z > this is clear of the body. */
const TORSO_FRONT = 0.1;

/**
 * The elbow of a rifle grip the manual holds with the forearm parallel to the
 * ground — the left hand at the butt at the slope (54-04: "left forearm
 * parallel to the ground, close to the body"; "left elbow close to the body").
 * The level plane through the wrist cuts the two-bone chain in two places. One
 * intersection falls inside the ribcage, which is not a place a joint can be, so
 * of the two the solver takes the one nearest the body that clears it: the
 * upper arm hangs by the side instead of winging out, and the forearm points
 * forward.
 */
export function rifleGripElbow(shoulder: Vec3, wrist: Vec3): Vec3 | null {
  const level = wrist[1];
  const drop = shoulder[1] - level;
  // A level forearm needs the elbow on the wrist's horizon, so the wrist must
  // hang less than a whole humerus below the shoulder.
  if (Math.abs(drop) >= BODY.humerus) return null;
  const r1 = Math.sqrt(BODY.humerus ** 2 - drop * drop);
  const r2 = BODY.forearm;
  const dx = wrist[0] - shoulder[0];
  const dz = wrist[2] - shoulder[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const across = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const ux = dx / d;
  const uz = dz / d;
  const bx = shoulder[0] + ux * along;
  const bz = shoulder[2] + uz * along;
  const a: Vec3 = [bx - uz * across, level, bz + ux * across];
  const b: Vec3 = [bx + uz * across, level, bz - ux * across];
  const clear = (p: Vec3) => Math.abs(p[0]) >= BODY.shoulderX - 0.02 || p[2] >= TORSO_FRONT;
  const options = [a, b].filter(clear).sort((p, q) => Math.abs(p[0]) - Math.abs(q[0]));
  return options[0] ?? (a[2] >= b[2] ? a : b);
}

/**
 * The elbow of a salute, solved rather than posed: on the horizontal plane
 * through the shoulder (the upper arm parallel to the ground), BODY.humerus
 * from the shoulder and BODY.forearm from the wrist. Of the two intersections
 * the salute takes the one that comes forward.
 */
export function levelElbow(shoulder: Vec3, wrist: Vec3): Vec3 | null {
  const dx = wrist[0] - shoulder[0];
  const dz = wrist[2] - shoulder[2];
  const span = Math.hypot(dx, dz);
  if (span < 1e-4) return null;
  const dy = wrist[1] - shoulder[1];
  const along =
    (BODY.humerus ** 2 + span ** 2 + dy ** 2 - BODY.forearm ** 2) /
    (2 * BODY.humerus * span);
  if (Math.abs(along) > 1) return null;
  const across = Math.sqrt(1 - along * along);
  const ax = (dx / span) * along;
  const az = (dz / span) * along;
  const bx = -(dz / span) * across;
  const bz = (dx / span) * across;
  const forward = az + bz >= az - bz;
  const x = forward ? ax + bx : ax - bx;
  const z = forward ? az + bz : az - bz;
  return [shoulder[0] + BODY.humerus * x, shoulder[1], shoulder[2] + BODY.humerus * z];
}

/** RIGHT DRESS: arm horizontal at shoulder height, hand closed, back up. */
export const DRESS_HANDS: { left: Vec3; right: Vec3 } = {
  left: [0.225, -0.25, 0.02],
  right: [-0.68, 0.26, 0.03],
};

/**
 * Dressing while bearing arms: the right hand keeps the rifle at the order and
 * the LEFT arm is raised (A-DH-201-000 Ch 2: "when bearing arms, dressing is
 * completed by raising the left arm rather than the right arm").
 */
export const DRESS_LEFT_RAISED: Vec3 = [0.68, 0.26, 0.03];

// ===================================================================== rifle
export const RIFLE = {
  /** Lee-Enfield No. 1 Mk III: 1.13 m overall. */
  length: 1.13,
  /** Distance from the butt to each grip. */
  grip: { small: 0.12, balance: 0.52, order: 0.915, muzzle: 1.11 },
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

/**
 * SALUTING AT SLOPE ARMS (54-04 para 90): the right arm comes across the body
 * and the hand strikes the small of the butt — not the headdress, which is the
 * salute without arms. The target is a point on the rifle, so the hand stays
 * on it whatever frame the rifle is carried in.
 */
export function armedSaluteHand(carriage: Carriage): Vec3 {
  return carriagePoint(carriage, RIFLE.grip.small);
}

const RIFLE_ORDER: Carriage = {
  // Butt on the square beside the right boot, rifle upright, right hand at the
  // upper band — the point the straight arm naturally reaches (0.90 m up).
  butt: [-0.235, GROUND_Y, 0.06],
  dir: [0, 1, 0],
  hands: { right: RIFLE.grip.order },
};

const RIFLE_SLOPE: Carriage = {
  // 54-04 para 27: the butt is held in the left hand in front of the left
  // shoulder, the rifle flat on the left shoulder, the left forearm parallel to
  // the ground. The butt sits 2 cm below the shoulder line and 17 cm forward,
  // with the barrel aimed through the hollow of the shoulder: at the old height
  // the left wrist hung 27.2 cm below the shoulder — more than a whole humerus —
  // so no level forearm existed and the elbow hung nine degrees low. The higher
  // frame both levels the left forearm and keeps the armed salute's target on
  // the small of the butt inside a level right arm's reach.
  butt: [0.2, -0.02, 0.17],
  dir: [0, 0.8374, -0.5475],
  roll: 12,
  hands: { left: 0.02 },
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
