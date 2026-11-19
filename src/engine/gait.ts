// Contact-driven human gait.
//
// The old model swung the legs with a sine wave and moved the body up and
// down by a fixed 16 mm. That is not how a body walks: a foot that is on the
// ground cannot move, the pelvis height is whatever the stance leg allows, the
// knee is a hinge that never bends backwards, and the foot rolls heel -> flat
// -> ball -> toe. This module models those constraints directly.
//
// Conventions, all in body space (origin on the ground under the pelvis,
// +Y up, +Z forward, +X to the cadet's left):
//   foot.x      ankle joint lateral position (+X = left)
//   foot.y      ankle joint height above the ground
//   foot.z      ankle joint forward position
//   foot.pitch  ankle angle, degrees, + = plantarflexion (toe down)
//   foot.toe    MTP angle, degrees, + = toes bend up relative to the foot
//   hipY        hip socket height, solved from the legs that are on the ground
//   sway        pelvis shift toward the stance foot, metres, + = left
//   list        pelvic list, degrees, + = left hip up
//   yaw         pelvic rotation, degrees, + = left hip forward
//
// Stance timing is the duty factor: a walking foot is on the ground for ~60%
// of the cycle. Because the body travels 2 * step per cycle, a planted foot
// must travel 2 * duty * step backwards through body space while it is down.
// Getting that arithmetic right is what removes foot skating.

import { JOINT_LIMITS, clampJoint } from './anatomy';
import type { Gait } from './types';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const frac = (v: number) => v - Math.floor(v);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Skeletal levers of the 1.78 m reference body, metres. */
export const LEG = {
  femur: 0.45,
  tibia: 0.42,
  /** Ankle joint centre above the sole of the boot. */
  ankle: 0.062,
  /** MTP joint ahead of the ankle. */
  mtp: 0.105,
  /** Ball of the foot ahead of the ankle: the lever the heel rises over. */
  ballLever: 0.14,
  /** Heel behind the ankle: the lever the toe rises over at heel strike. */
  heelLever: 0.055,
  /** Hip socket lateral offset from the midline. */
  hipX: 0.098,
  /** Ankle track while marching. */
  trackX: 0.085,
  /** Ankles at attention: heels together, toes out. */
  standX: 0.04,
} as const;

/** Maximum hip-to-ankle distance with the knee straight. */
export const REACH = LEG.femur + LEG.tibia;

export type Vec3 = [number, number, number];

export interface GaitSpec {
  label: string;
  /** Ground covered per step, metres. Must match the simulated pace. */
  step: number;
  /** Fraction of the cycle each foot is on the ground. */
  duty: number;
  /** Steps per minute. */
  cadence: number;
  /** Peak additional ankle height in swing, metres. */
  lift: number;
  /** Trunk lean, degrees. */
  lean: number;
  /** Shoulder swing either side of vertical, degrees. */
  armSwing: number;
  /** Baseline elbow flexion, degrees. */
  elbow: number;
  /** Extra elbow flexion on the forward half of the swing, degrees. */
  elbowSwing: number;
  /** Pelvis lateral sway, metres. */
  sway: number;
  /** Pelvic list, degrees. */
  list: number;
  /** Pelvic rotation, degrees. */
  yaw: number;
  /** Toe-out while marching, degrees. */
  toeOut: number;
}

/**
 * Biomechanics of each gait. Quick and slow time are 75 cm paces (the manual's
 * 30-inch pace); double time is a 1 m running step with a flight phase. The
 * duty factors are human walking/running ratios, not drill ideals: normal
 * walking is ~60% stance, running ~40%.
 */
export const GAIT_SPEC: Record<Gait, GaitSpec> = {
  halt: {
    label: 'Halt',
    step: 0,
    duty: 1,
    cadence: 0,
    lift: 0,
    lean: 0,
    armSwing: 0,
    elbow: 0,
    elbowSwing: 0,
    sway: 0,
    list: 0,
    yaw: 0,
    toeOut: 15,
  },
  slow: {
    label: 'Slow time',
    step: 0.75,
    duty: 0.6,
    cadence: 60,
    lift: 0.06,
    lean: 1,
    armSwing: 8,
    elbow: 6,
    elbowSwing: 2,
    sway: 0.021,
    list: 3,
    yaw: 3,
    toeOut: 8,
  },
  quick: {
    label: 'Quick time',
    step: 0.75,
    duty: 0.58,
    cadence: 120,
    lift: 0.09,
    lean: 2,
    // Drill swing, not a stroll: the manual swings the arm "straight forward"
    // from the shoulder, waist high. A straight arm at 34° puts the hand at
    // the waist and clears the tunic; the earlier 16° arc with an 8° elbow
    // read as a leisurely walk. Keep the elbow nearly straight as ordered.
    armSwing: 34,
    // 8° keeps the elbow just off lock: a genuinely straight arm makes the
    // two-bone IK singular, which is a source of arm jitter, not realism.
    elbow: 8,
    elbowSwing: 3,
    sway: 0.028,
    list: 4,
    yaw: 4,
    toeOut: 6,
  },
  double: {
    label: 'Double time',
    step: 1,
    duty: 0.42,
    cadence: 180,
    lift: 0.22,
    lean: 4.5,
    armSwing: 30,
    elbow: 72,
    elbowSwing: 16,
    sway: 0.02,
    list: 3,
    yaw: 6,
    toeOut: 4,
  },
  markTime: {
    label: 'Mark time',
    step: 0,
    duty: 0.56,
    cadence: 120,
    lift: 0.25,
    lean: 1,
    // Marking time, the arms stay at the sides and the hands are closed: the
    // movement is in the knee, not in a swing.
    armSwing: 0,
    elbow: 6,
    elbowSwing: 0,
    sway: 0.012,
    list: 2,
    yaw: 0,
    toeOut: 8,
  },
};

// ------------------------------------------------------------------ curves
type Key = readonly [number, number];

function curve(t: number, keys: readonly Key[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i];
    if (t <= b[0]) {
      const a = keys[i - 1];
      const span = b[0] - a[0] || 1;
      return a[1] + (b[1] - a[1]) * smoothstep(clamp((t - a[0]) / span, 0, 1));
    }
  }
  return keys[keys.length - 1][1];
}

/** Knee flexion through stance: nearly straight at contact, loading response, push-off. */
const STANCE_KNEE: readonly Key[] = [
  [0, 2],
  [0.1, 15],
  [0.32, 14],
  [0.58, 12],
  [0.8, 22],
  [1, 38],
];

/** Ankle rockers: heel strike, foot flat, heel off, toe off. */
const STANCE_PITCH: readonly Key[] = [
  [0, -11],
  [0.08, 0],
  [0.42, 0],
  [0.58, 5],
  [0.74, 15],
  [0.9, 25],
  [1, 32],
];

/** Swing ankle: toe-off, clear the ground, dorsiflex for heel strike. */
const SWING_PITCH: readonly Key[] = [
  [0, 32],
  [0.12, 22],
  [0.45, 3],
  [0.76, -8],
  [1, -11],
];

/** MTP extension in swing: the toes relax after they leave the ground. */
const SWING_TOE: readonly Key[] = [
  [0, 34],
  [0.22, 7],
  [0.45, 0],
  [1, 0],
];

export type Side = 'L' | 'R';

export interface FootTarget {
  x: number;
  y: number;
  z: number;
  pitch: number;
  toe: number;
  yaw: number;
  planted: boolean;
  contact: 'heel' | 'flat' | 'ball' | 'toe' | 'none';
  /** Knee flexion this foot's geometry produces, filled in by gaitTargets. */
  knee: number;
}

export interface GaitTargets {
  cycle: number;
  left: FootTarget;
  right: FootTarget;
  /** Hip socket height above the ground. */
  hipY: number;
  sway: number;
  list: number;
  yaw: number;
  lean: number;
  /** Shoulder flexion, degrees, forward positive. */
  armL: number;
  armR: number;
  elbowL: number;
  elbowR: number;
  /** Femur angle from vertical, degrees, forward positive. */
  hipFlexL: number;
  hipFlexR: number;
  flight: boolean;
  step: number;
  duty: number;
  /** Ground speed for this gait, m/s. */
  speed: number;
}

export interface KneeSolution {
  knee: Vec3;
  /** Hip-to-ankle distance, metres. */
  span: number;
  kneeFlexion: number;
  hipFlexion: number;
  reachable: boolean;
}

/**
 * Two-bone knee solve. The knee is a hinge, so it is placed on the forward
 * side of the hip-ankle line and can never end up behind it. The returned
 * angles are the anatomical ones: hip flexion of the femur and knee flexion
 * between femur and tibia.
 */
export function solveKnee(hip: Vec3, ankle: Vec3, pole: Vec3 = [0, 0, 1]): KneeSolution {
  const vx = ankle[0] - hip[0];
  const vy = ankle[1] - hip[1];
  const vz = ankle[2] - hip[2];
  const span = Math.hypot(vx, vy, vz);
  const d = clamp(span, Math.abs(LEG.femur - LEG.tibia) + 0.01, REACH - 1e-6);
  const ux = vx / (span || 1);
  const uy = vy / (span || 1);
  const uz = vz / (span || 1);
  const along = (LEG.femur * LEG.femur - LEG.tibia * LEG.tibia + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0.0001, LEG.femur * LEG.femur - along * along));
  // Project the pole (forward) perpendicular to the hip-ankle line.
  let px = pole[0] - ux * (pole[0] * ux + pole[1] * uy + pole[2] * uz);
  let py = pole[1] - uy * (pole[0] * ux + pole[1] * uy + pole[2] * uz);
  let pz = pole[2] - uz * (pole[0] * ux + pole[1] * uy + pole[2] * uz);
  let plen = Math.hypot(px, py, pz);
  if (plen < 1e-5) {
    px = 0;
    py = 1;
    pz = 0;
    plen = 1;
  }
  px /= plen;
  py /= plen;
  pz /= plen;
  const knee: Vec3 = [
    hip[0] + ux * along + px * height,
    hip[1] + uy * along + py * height,
    hip[2] + uz * along + pz * height,
  ];
  const fx = knee[0] - hip[0];
  const fy = knee[1] - hip[1];
  const fz = knee[2] - hip[2];
  const hipFlexion = Math.atan2(fz, -fy) * DEG;
  const kneeFlexion =
    Math.acos(clamp((d * d - LEG.femur * LEG.femur - LEG.tibia * LEG.tibia) / (2 * LEG.femur * LEG.tibia), -1, 1)) * DEG;
  return { knee, span, kneeFlexion, hipFlexion, reachable: span <= REACH + 1e-4 };
}

// -------------------------------------------------------------- gait phase
/** Cycle position for a gait, 0..1. Walking is driven by distance, not time. */
export function gaitCycle(gait: Gait, stride: number, time: number): number {
  const spec = GAIT_SPEC[gait] ?? GAIT_SPEC.halt;
  if (gait === 'halt' || spec.step <= 0) {
    if (gait === 'markTime') return frac((time * spec.cadence) / 120);
    return 0;
  }
  return frac(stride / (2 * spec.step));
}

// ------------------------------------------------------------- foot targets
function standingFoot(side: Side): FootTarget {
  return {
    x: side === 'L' ? LEG.standX : -LEG.standX,
    y: LEG.ankle,
    z: 0,
    pitch: 0,
    toe: 0,
    yaw: side === 'L' ? 15 : -15,
    planted: true,
    contact: 'flat',
    knee: 0,
  };
}

function stanceFoot(side: Side, spec: GaitSpec, s: number): FootTarget {
  const stance = spec.step * spec.duty;
  const z = stance * (1 - 2 * s);
  const pitch = curve(s, STANCE_PITCH);
  const ankleY = LEG.ankle + (pitch >= 0 ? LEG.ballLever * Math.sin(pitch * RAD) : LEG.heelLever * Math.sin(-pitch * RAD));
  const contact: FootTarget['contact'] =
    s < 0.055 ? 'heel' : s < 0.42 ? 'flat' : s < 0.78 ? 'ball' : 'toe';
  return {
    x: side === 'L' ? LEG.trackX : -LEG.trackX,
    y: ankleY,
    z,
    pitch,
    // The toe stays flat on the ground while the heel rises, so the MTP
    // extension equals the shank's plantarflexion.
    toe: pitch > 0 ? Math.min(46, pitch) : 0,
    yaw: side === 'L' ? spec.toeOut : -spec.toeOut,
    planted: true,
    contact,
    knee: 0,
  };
}

function swingFoot(side: Side, spec: GaitSpec, w: number): FootTarget {
  const stance = spec.step * spec.duty;
  const z = -stance + 2 * stance * smoothstep(w);
  const toeOffY = LEG.ankle + LEG.ballLever * Math.sin(32 * RAD);
  const contactY = LEG.ankle + LEG.heelLever * Math.sin(11 * RAD);
  const y = clamp(
    toeOffY + (contactY - toeOffY) * w + spec.lift * Math.pow(Math.sin(Math.PI * w), 0.85),
    LEG.ankle * 0.9,
    1.4,
  );
  const pitch = curve(w, SWING_PITCH);
  const toe = curve(w, SWING_TOE);
  const track = side === 'L' ? LEG.trackX : -LEG.trackX;
  const inward = 0.012 * Math.sin(Math.PI * w);
  return {
    x: track - (side === 'L' ? inward : -inward),
    y,
    z,
    pitch,
    toe,
    yaw: side === 'L' ? spec.toeOut : -spec.toeOut,
    planted: false,
    contact: 'none',
    knee: 0,
  };
}

function markTimeFoot(side: Side, spec: GaitSpec, cycle: number): FootTarget {
  const contactAt = side === 'L' ? 0 : 0.5;
  const p = frac(cycle - contactAt);
  if (p < spec.duty) {
    return {
      x: side === 'L' ? LEG.trackX : -LEG.trackX,
      y: LEG.ankle,
      z: 0,
      pitch: 0,
      toe: 0,
      yaw: side === 'L' ? spec.toeOut : -spec.toeOut,
      planted: true,
      contact: 'flat',
      knee: 0,
    };
  }
  const w = (p - spec.duty) / (1 - spec.duty);
  const arc = Math.pow(Math.sin(Math.PI * w), 0.9);
  return {
    x: side === 'L' ? LEG.trackX : -LEG.trackX,
    y: LEG.ankle + 0.25 * arc,
    z: 0.16 * arc,
    pitch: 18 * arc,
    toe: 0,
    yaw: side === 'L' ? spec.toeOut : -spec.toeOut,
    planted: false,
    contact: 'none',
    knee: 0,
  };
}

// ---------------------------------------------------------------- assembly
export function standTargets(): GaitTargets {
  const dx = LEG.hipX - LEG.standX;
  const hipY = Math.sqrt(Math.max(0, REACH * REACH - dx * dx)) + LEG.ankle;
  const left = standingFoot('L');
  const right = standingFoot('R');
  left.knee = 0;
  right.knee = 0;
  return {
    cycle: 0,
    left,
    right,
    hipY,
    sway: 0,
    list: 0,
    yaw: 0,
    lean: 0,
    armL: 0,
    armR: 0,
    elbowL: 4,
    elbowR: 4,
    hipFlexL: 0,
    hipFlexR: 0,
    flight: false,
    step: 0,
    duty: 1,
    speed: 0,
  };
}

/** Hip height that a leg can still reach, with the knee just short of lock. */
function reachCap(hipLateral: number, foot: FootTarget): number {
  const horiz = Math.hypot(foot.x - hipLateral, foot.z);
  return foot.y + Math.sqrt(Math.max(0.0001, (REACH - 0.004) ** 2 - horiz * horiz));
}

/** Hip height that puts the stance knee at its prescribed angle. */
function prescribedHip(hipLateral: number, foot: FootTarget, s: number): number {
  const knee = curve(s, STANCE_KNEE) * RAD;
  const d = Math.sqrt(LEG.femur ** 2 + LEG.tibia ** 2 + 2 * LEG.femur * LEG.tibia * Math.cos(knee));
  const horiz = Math.hypot(foot.x - hipLateral, foot.z);
  return foot.y + Math.sqrt(Math.max(0.0001, d * d - horiz * horiz));
}

/**
 * Solve one instant of a gait. The pelvis height is the lower of (a) the
 * highest prescribed stance height and (b) the lowest reach of a planted foot:
 * the body can never stand higher than a foot can stay on the ground, and it
 * can never stand so high that a planted leg has to straighten past its lock.
 */
export function gaitTargets(gait: Gait, cycle: number): GaitTargets {
  const spec = GAIT_SPEC[gait] ?? GAIT_SPEC.halt;
  const c = frac(cycle);
  if (gait === 'halt') return standTargets();

  const sLong = Math.sin(Math.PI * 2 * (c - 0.05));
  const sway = spec.sway * sLong;
  const left = gait === 'markTime' ? markTimeFoot('L', spec, c) : footAt('L', spec, c);
  const right = gait === 'markTime' ? markTimeFoot('R', spec, c) : footAt('R', spec, c);

  // Stance progress for the knee prescription.
  const stanceProgress = (foot: FootTarget, side: Side): number => {
    if (!foot.planted || spec.duty >= 1) return 0;
    const contactAt = side === 'L' ? 0 : 0.5;
    return clamp(frac(c - contactAt) / spec.duty, 0, 1);
  };

  let prescribed = -Infinity;
  let cap = Infinity;
  for (const [foot, side] of [
    [left, 'L'] as const,
    [right, 'R'] as const,
  ]) {
    if (!foot.planted) continue;
    const lateral = (side === 'L' ? LEG.hipX : -LEG.hipX) + sway;
    const s = stanceProgress(foot, side);
    prescribed = Math.max(prescribed, prescribedHip(lateral, foot, s));
    cap = Math.min(cap, reachCap(lateral, foot));
  }

  let hipY: number;
  let flight = false;
  if (!Number.isFinite(prescribed)) {
    flight = true;
    // Running flight: leave the ground from the push-off height, land at the
    // next contact height, with a small ballistic rise between.
    const gap = 0.5 - spec.duty;
    const w = gap > 0 ? frac((c - spec.duty) / gap) : 0;
    hipY = standTargets().hipY - 0.1 + 0.04 * Math.sin(Math.PI * w);
  } else {
    hipY = Math.min(prescribed, cap);
  }

  const lean = spec.lean;
  const armPhase = Math.cos(Math.PI * 2 * c);
  const armL = -spec.armSwing * armPhase;
  const armR = spec.armSwing * armPhase;
  const elbowL = spec.elbow + spec.elbowSwing * Math.max(0, -armPhase);
  const elbowR = spec.elbow + spec.elbowSwing * Math.max(0, armPhase);

  const finish = (foot: FootTarget, side: Side): number => {
    const hip: Vec3 = [(side === 'L' ? LEG.hipX : -LEG.hipX) + sway, hipY, 0];
    const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
    foot.knee = sol.kneeFlexion;
    return sol.hipFlexion;
  };
  const hipFlexL = finish(left, 'L');
  const hipFlexR = finish(right, 'R');

  return {
    cycle: c,
    left,
    right,
    hipY,
    sway,
    list: spec.list * Math.sin(Math.PI * 2 * (c - 0.04)),
    yaw: spec.yaw * Math.cos(Math.PI * 2 * c),
    lean,
    armL,
    armR,
    elbowL,
    elbowR,
    hipFlexL,
    hipFlexR,
    flight,
    step: spec.step,
    duty: spec.duty,
    speed: (spec.step * spec.cadence) / 60,
  };
}

function footAt(side: Side, spec: GaitSpec, cycle: number): FootTarget {
  const contactAt = side === 'L' ? 0 : 0.5;
  const p = frac(cycle - contactAt);
  if (p < spec.duty) return stanceFoot(side, spec, p / spec.duty);
  return swingFoot(side, spec, (p - spec.duty) / (1 - spec.duty));
}

/** Blend two instants; used to settle into and out of the halt. */
export function blendTargets(a: GaitTargets, b: GaitTargets, t: number): GaitTargets {
  const mix = (x: number, y: number) => x + (y - x) * t;
  const foot = (x: FootTarget, y: FootTarget): FootTarget => ({
    x: mix(x.x, y.x),
    y: mix(x.y, y.y),
    z: mix(x.z, y.z),
    pitch: mix(x.pitch, y.pitch),
    toe: mix(x.toe, y.toe),
    yaw: mix(x.yaw, y.yaw),
    planted: t < 0.5 ? x.planted : y.planted,
    contact: t < 0.5 ? x.contact : y.contact,
    knee: mix(x.knee, y.knee),
  });
  return {
    cycle: b.cycle,
    left: foot(a.left, b.left),
    right: foot(a.right, b.right),
    hipY: mix(a.hipY, b.hipY),
    sway: mix(a.sway, b.sway),
    list: mix(a.list, b.list),
    yaw: mix(a.yaw, b.yaw),
    lean: mix(a.lean, b.lean),
    armL: mix(a.armL, b.armL),
    armR: mix(a.armR, b.armR),
    elbowL: mix(a.elbowL, b.elbowL),
    elbowR: mix(a.elbowR, b.elbowR),
    hipFlexL: mix(a.hipFlexL, b.hipFlexL),
    hipFlexR: mix(a.hipFlexR, b.hipFlexR),
    flight: t < 0.5 ? a.flight : b.flight,
    step: mix(a.step, b.step),
    duty: mix(a.duty, b.duty),
    speed: mix(a.speed, b.speed),
  };
}

// ------------------------------------------------------------------- turns
export interface TurnPose {
  /** 0..1, how hard the body is turning. */
  magnitude: number;
  /** Foot that stays planted and pivots. */
  inside: Side;
  /** Trunk lean into the turn, degrees. */
  lean: number;
  /** Pelvic list into the turn, degrees. + = left hip up. */
  list: number;
  /** Pelvic rotation relative to the feet, degrees. + = left hip forward. */
  pelvisYaw: number;
  /** Chest lead over the pelvis, degrees. */
  chestYaw: number;
  /** Head lead over the chest, degrees. */
  headYaw: number;
  /** Heel raise on the pivot foot, degrees. */
  insideHeel: number;
  /** Heel raise on the outside foot, metres of ankle lift. */
  outsideLift: number;
  /** Extra yaw on the pivot foot, degrees. */
  insideYaw: number;
  /** Extra yaw on the stepping foot, degrees. */
  outsideYaw: number;
  /** Pelvis shift toward the pivot foot, metres. */
  shift: number;
}

/**
 * Turning is not a rotation of the whole body. The head leads, the chest
 * follows, the pelvis lags over the planted foot, the body leans into the arc
 * and the inside foot pivots on its ball while the outside foot steps around.
 * `rate` is heading change in degrees per second; positive turns right.
 */
export function turnPose(rate: number): TurnPose {
  const magnitude = clamp(Math.abs(rate) / 140, 0, 1);
  const sign = magnitude === 0 ? 0 : rate >= 0 ? 1 : -1;
  return {
    magnitude,
    inside: sign > 0 ? 'R' : 'L',
    lean: 5 * magnitude,
    list: 6 * magnitude * sign,
    pelvisYaw: -9 * magnitude * sign,
    chestYaw: 14 * magnitude * sign,
    headYaw: 22 * magnitude * sign,
    insideHeel: 14 * magnitude,
    outsideLift: 0.065 * magnitude,
    insideYaw: -12 * magnitude * sign,
    outsideYaw: 6 * magnitude * sign,
    shift: -0.022 * magnitude * sign,
  };
}

// ------------------------------------------------------------------- audit
export interface GaitReport {
  gait: Gait;
  samples: number;
  /** Fraction of the cycle with at least one foot down. */
  support: number;
  stanceFraction: number;
  hipMinCm: number;
  hipMaxCm: number;
  hipRangeCm: number;
  contactDriftCm: number;
  clearanceCm: number;
  maxHip: number;
  maxKnee: number;
  minKnee: number;
  maxAnkle: number;
  maxToe: number;
  kneeBreaches: number;
  limitBreaches: number;
  symmetryCm: number;
  score: number;
}

export interface GaitAudit {
  reports: GaitReport[];
  breaches: number;
  score: number;
}

/** A planted foot's position in the world: the body advances 2*step per cycle. */
function worldFootZ(gait: Gait, cycle: number, foot: FootTarget): number {
  const spec = GAIT_SPEC[gait];
  return cycle * 2 * spec.step + foot.z;
}

function auditOne(gait: Gait, samples = 240): GaitReport {
  const spec = GAIT_SPEC[gait];
  let hipMin = Infinity;
  let hipMax = -Infinity;
  let support = 0;
  let clearance = 0;
  let maxHip = -Infinity;
  let maxKnee = -Infinity;
  let minKnee = Infinity;
  let maxAnkle = -Infinity;
  let maxToe = -Infinity;
  let kneeBreaches = 0;
  let limitBreaches = 0;
  let drift = 0;
  for (let i = 0; i < samples; i += 1) {
    const cycle = i / samples;
    const g = gaitTargets(gait, cycle);
    hipMin = Math.min(hipMin, g.hipY);
    hipMax = Math.max(hipMax, g.hipY);
    if (g.left.planted || g.right.planted) support += 1;
    maxHip = Math.max(maxHip, g.hipFlexL, g.hipFlexR);
    maxKnee = Math.max(maxKnee, g.left.knee, g.right.knee);
    minKnee = Math.min(minKnee, g.left.knee, g.right.knee);
    maxAnkle = Math.max(maxAnkle, g.left.pitch, g.right.pitch);
    maxToe = Math.max(maxToe, g.left.toe, g.right.toe);
    const swinging = [g.left, g.right].filter((f) => !f.planted).map((f) => f.y);
    if (swinging.length) clearance = Math.max(clearance, Math.min(...swinging));
    for (const [foot, side] of [
      [g.left, 'L'] as const,
      [g.right, 'R'] as const,
    ]) {
      const hip: Vec3 = [(side === 'L' ? LEG.hipX : -LEG.hipX) + g.sway, g.hipY, 0];
      const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
      if (foot.planted && (!sol.reachable || sol.span > REACH + 1e-4)) limitBreaches += 1;
      // The knee must sit forward of the hip-ankle line, never behind it.
      if (sol.knee[2] < Math.min(hip[2], foot.z) - 0.005) kneeBreaches += 1;
      for (const [joint, value] of [
        ['hipFlexion', sol.hipFlexion],
        ['kneeFlexion', sol.kneeFlexion],
        ['anklePlantar', foot.pitch],
        ['toeExtension', foot.toe],
      ] as const) {
        const lim = JOINT_LIMITS[joint];
        if (value < lim.min - 1e-6 || value > lim.max + 1e-6) limitBreaches += 1;
      }
    }
  }
  // Foot skating: a planted foot should hold the same world position.
  for (const side of ['L', 'R'] as const) {
    const start = side === 'L' ? 0 : 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= samples; i += 1) {
      const cycle = start + (spec.duty * i) / samples;
      const foot = gaitTargets(gait, cycle)[side === 'L' ? 'left' : 'right'];
      if (!foot.planted) continue;
      const z = worldFootZ(gait, cycle, foot);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    if (Number.isFinite(lo)) drift = Math.max(drift, hi - lo);
  }
  // Symmetry: the two legs half a cycle apart must mirror.
  const a = gaitTargets(gait, 0.25);
  const b = gaitTargets(gait, 0.75);
  const symmetry = Math.max(
    Math.abs(a.hipFlexL - b.hipFlexR),
    Math.abs(a.hipFlexR - b.hipFlexL),
    Math.abs(a.left.knee - b.right.knee),
    Math.abs(a.right.knee - b.left.knee),
  );

  const vertical = hipMax - hipMin;
  const driftCm = drift * 100;
  const clearanceCm = clearance * 100;
  const tolerance = (value: number, limit: number) => clamp(1 - value / limit, 0, 1);
  const score =
    0.3 * tolerance(kneeBreaches, 1) +
    0.2 * tolerance(limitBreaches, 1) +
    0.2 * tolerance(driftCm, 0.5) +
    0.15 * tolerance(symmetry, 2) +
    0.15 * tolerance(Math.max(0, vertical - 0.1), 0.06);

  return {
    gait,
    samples,
    support: support / samples,
    stanceFraction: spec.duty,
    hipMinCm: hipMin * 100,
    hipMaxCm: hipMax * 100,
    hipRangeCm: vertical * 100,
    contactDriftCm: driftCm,
    clearanceCm,
    maxHip,
    maxKnee,
    minKnee,
    maxAnkle,
    maxToe,
    kneeBreaches,
    limitBreaches,
    symmetryCm: symmetry,
    score: clamp(score, 0, 1),
  };
}

/** Numeric self-check of every gait against contact, hinge and joint rules. */
export function auditGaits(samples = 240): GaitAudit {
  const reports = (Object.keys(GAIT_SPEC) as Gait[]).map((gait) => auditOne(gait, samples));
  const breaches = reports.reduce((n, r) => n + r.kneeBreaches + r.limitBreaches, 0);
  const score = reports.reduce((n, r) => n + r.score, 0) / reports.length;
  return { reports, breaches, score };
}

/** Joint limits that the gait touches, re-exported for tests and the HUD. */
export const GAIT_LIMITS = {
  hip: JOINT_LIMITS.hipFlexion,
  knee: JOINT_LIMITS.kneeFlexion,
  ankle: JOINT_LIMITS.anklePlantar,
  toe: JOINT_LIMITS.toeExtension,
} as const;

/** Clamp helper shared with the figure so a blended pose can never break a joint. */
export function clampGait(gait: Gait, hip: number, knee: number, ankle: number): [number, number, number] {
  void gait;
  return [
    clampJoint('hipFlexion', hip),
    clampJoint('kneeFlexion', knee),
    clampJoint('anklePlantar', ankle),
  ];
}

export { clamp, frac, smoothstep, smootherstep, RAD, DEG };
