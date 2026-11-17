// Anatomical joint model for the cadet figure.
//
// Every pose the drill engine asks for is expressed as joint motion, not as
// arbitrary mesh rotation: the thigh flexes at the hip, the shank folds at the
// knee, the arm swings at the shoulder and folds at the elbow, the neck turns at
// the atlanto-axial joint. Each value is clamped to a physiological range so a
// drill command can never produce a joint that a body does not have.

import type { Gait, Posture } from './types';

export type BodyMode = 'uniform' | 'xray' | 'skeleton' | 'muscles';

export interface JointLimit {
  label: string;
  /** Anatomical range in degrees, signed (flexion positive, extension negative). */
  min: number;
  max: number;
  /** What the joint is doing when the value is positive. */
  positive: string;
  negative: string;
}

/**
 * Active ranges of motion for a young adult, from orthopaedic goniometry
 * standards (AAOS / Norkin & White). Drill never uses the full range; these are
 * the ceilings that stop a bad pose from folding a knee backwards.
 */
export const JOINT_LIMITS = {
  hipFlexion: { label: 'Hip flexion', min: -20, max: 120, positive: 'flexion', negative: 'extension' },
  hipAbduction: { label: 'Hip abduction', min: 0, max: 45, positive: 'abduction', negative: '' },
  kneeFlexion: { label: 'Knee flexion', min: 0, max: 140, positive: 'flexion', negative: '' },
  anklePlantar: { label: 'Ankle plantarflexion', min: -20, max: 50, positive: 'plantarflexion', negative: 'dorsiflexion' },
  shoulderFlexion: { label: 'Shoulder flexion', min: -60, max: 180, positive: 'flexion', negative: 'extension' },
  shoulderAbduction: { label: 'Shoulder abduction', min: -45, max: 180, positive: 'abduction', negative: 'adduction' },
  elbowFlexion: { label: 'Elbow flexion', min: 0, max: 145, positive: 'flexion', negative: 'hyperextension' },
  wristExtension: { label: 'Wrist extension', min: -80, max: 70, positive: 'extension', negative: 'flexion' },
  cervicalRotation: { label: 'Cervical rotation', min: -80, max: 80, positive: 'right', negative: 'left' },
  cervicalFlexion: { label: 'Cervical flexion', min: -60, max: 50, positive: 'flexion', negative: 'extension' },
  thoracicRotation: { label: 'Thoracic rotation', min: -45, max: 45, positive: 'right', negative: 'left' },
  lumbarFlexion: { label: 'Lumbar flexion', min: -25, max: 60, positive: 'flexion', negative: 'extension' },
  pelvicTilt: { label: 'Pelvic list', min: -15, max: 15, positive: 'right drop', negative: 'left drop' },
} as const;

export type JointName = keyof typeof JOINT_LIMITS;

export function clampJoint(joint: JointName, value: number): number {
  const limit = JOINT_LIMITS[joint];
  return Math.max(limit.min, Math.min(limit.max, value));
}

export interface JointReading {
  joint: JointName;
  label: string;
  side?: 'L' | 'R';
  value: number;
  min: number;
  max: number;
}

export function reading(joint: JointName, value: number, side?: 'L' | 'R'): JointReading {
  const limit = JOINT_LIMITS[joint];
  const rounded = Math.round(value);
  return {
    joint,
    label: limit.label,
    side,
    // Normalise negative zero so a neutral joint always reads 0.
    value: rounded === 0 ? 0 : rounded,
    min: limit.min,
    max: limit.max,
  };
}

export interface DrillAnatomy {
  /** Forward hip flexion at the top of the swing. */
  hip: number;
  /** Rear hip extension at the opposite extreme. */
  hipBack: number;
  /** Knee flexion of the leading leg at the top of the swing. */
  knee: number;
  /** Knee flexion of the trailing leg as it leaves the ground. */
  kneeBack: number;
  ankle: number;
  /** Shoulder swing either side of the vertical, forward positive. */
  shoulderSwing: number;
  elbow: number;
  /** Extra trunk flexion carried by the gait. */
  trunk: number;
  note: string;
}

/**
 * What the manual actually asks the body to do in each gait, converted to
 * joint angles. The manual gives the visible result (foot 30 cm up, thigh
 * parallel to the ground); these are the angles that produce it for a 1.78 m
 * cadet with a 45 cm femur and 42 cm tibia.
 */
export const GAIT_ANATOMY: Record<Gait, DrillAnatomy> = {
  halt: {
    hip: 0,
    hipBack: 0,
    knee: 0,
    kneeBack: 0,
    ankle: 0,
    shoulderSwing: 0,
    elbow: 0,
    trunk: 0,
    note: 'At the halt the knees are locked, the ankles neutral and the arms hang with the elbows straight.',
  },
  quick: {
    hip: 28,
    hipBack: 14,
    knee: 4,
    kneeBack: 26,
    ankle: 18,
    shoulderSwing: 26,
    elbow: 22,
    trunk: 1.5,
    note: 'Quick march: the leg swings forward with the knee straight and the foot about 30 cm clear of the ground; that is 28° of hip flexion, a straight knee and 18° of plantarflexion, with the toe pointing down.',
  },
  slow: {
    hip: 20,
    hipBack: 10,
    knee: 3,
    kneeBack: 18,
    ankle: 30,
    shoulderSwing: 14,
    elbow: 16,
    trunk: 1,
    note: 'Slow march: a shorter swing with the toe held pointed, so the ankle stays in 30° of plantarflexion through the step.',
  },
  double: {
    hip: 45,
    hipBack: 20,
    knee: 95,
    kneeBack: 60,
    ankle: 10,
    shoulderSwing: 45,
    elbow: 90,
    trunk: 4,
    note: 'Double march: the knee drives up towards the chest, 45° of hip flexion and 95° of knee flexion, the elbows close to 90° and the trunk carried slightly forward.',
  },
  markTime: {
    hip: 90,
    hipBack: 0,
    knee: 90,
    kneeBack: 4,
    ankle: 12,
    shoulderSwing: 22,
    elbow: 22,
    trunk: 1,
    note: 'Mark time: the thigh comes up parallel to the ground and the shank hangs vertical, which is 90° at the hip and 90° at the knee, the foot 15 cm above the ground.',
  },
};

/** Wrist and spine detail that the drill commands add on top of the gait. */
export const DRILL_WRIST: Record<Posture, number> = {
  attention: 0,
  standAtEase: -10,
  standEasy: -12,
  salute: 12,
};

export const DRILL_SPINE: Record<Posture, { lumbar: number; thoracic: number; cervical: number }> = {
  attention: { lumbar: 0, thoracic: 0, cervical: 0 },
  standAtEase: { lumbar: 2, thoracic: 0, cervical: 0 },
  standEasy: { lumbar: 4, thoracic: 2, cervical: 2 },
  salute: { lumbar: -2, thoracic: -2, cervical: 0 },
};

/**
 * Eyes right is a rotation of the cervical spine, not the whole torso: the
 * atlanto-axial joint carries about 45° while the thoracic spine adds a few
 * degrees and the shoulders stay square to the front.
 */
export const EYES_RIGHT = { cervical: 45, thoracic: 6 };

export const BODY_MODES: { value: BodyMode; label: string; hint: string }[] = [
  { value: 'uniform', label: 'Uniform', hint: 'The cadet as they appear on parade.' },
  { value: 'xray', label: 'X-ray', hint: 'Translucent uniform over the moving skeleton.' },
  { value: 'skeleton', label: 'Skeleton', hint: 'Bones and joints only, every joint visible.' },
  { value: 'muscles', label: 'Muscles', hint: 'Skeleton plus the muscle groups that drive each joint.' },
];

export const ANATOMY_NOTES: { title: string; body: string }[] = [
  {
    title: 'Knee height',
    body:
      'Mark time and double march lift the thigh to horizontal — 90° of hip flexion with 90–95° of knee flexion. Quick and slow march keep the knee almost straight (0–5°) and lift the whole leg from the hip instead, which is why the foot clears the ground without the knee rising.',
  },
  {
    title: 'Arm swing',
    body:
      'The arm swings at the shoulder, not the elbow. Quick march uses roughly ±26° of shoulder flexion with about 22° of elbow flexion; the elbow is never locked and never pumped. When a rifle or colour is carried, that arm is fixed and only the free arm swings.',
  },
  {
    title: 'Head and neck',
    body:
      'Eyes right is 45° of cervical rotation with the head level — the neck turns, the shoulders do not. The thoracic spine contributes only a few degrees, which is why a formed body keeps its dressing while looking right.',
  },
  {
    title: 'Trunk',
    body:
      'The trunk is held upright in all drill. Double march adds about 4° of forward lean; the spine itself stays neutral, with the pelvis and thorax counter-rotating by a few degrees during the step.',
  },
];
