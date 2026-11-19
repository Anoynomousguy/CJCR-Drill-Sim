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
  hipFlexion: { label: 'Hip flexion', min: -28, max: 120, positive: 'flexion', negative: 'extension' },
  hipAbduction: { label: 'Hip abduction', min: 0, max: 45, positive: 'abduction', negative: '' },
  kneeFlexion: { label: 'Knee flexion', min: 0, max: 140, positive: 'flexion', negative: '' },
  anklePlantar: { label: 'Ankle plantarflexion', min: -20, max: 50, positive: 'plantarflexion', negative: 'dorsiflexion' },
  toeExtension: { label: 'Toe (MTP) extension', min: 0, max: 60, positive: 'extension', negative: '' },
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
    hip: 30,
    hipBack: 15,
    knee: 8,
    kneeBack: 40,
    ankle: 32,
    shoulderSwing: 16,
    elbow: 8,
    trunk: 2,
    note: 'Quick march: the heel strikes with the hip flexed about 30° and the knee almost straight, the stance knee absorbs 15° as the body rolls over the foot, and the heel lifts to 32° of plantarflexion at toe-off. The arms swing straight from the shoulder — the elbow stays within a few degrees of lock — because the manual swings the hand forward, not the forearm. The swing knee bends about 40° only to clear the ground.',
  },
  slow: {
    hip: 30,
    hipBack: 12,
    knee: 8,
    kneeBack: 34,
    ankle: 32,
    shoulderSwing: 8,
    elbow: 6,
    trunk: 1,
    note: 'Slow march: the same grounded step as quick time at half the cadence, with the toe held pointed through the swing and the arms barely swinging.',
  },
  double: {
    hip: 45,
    hipBack: 20,
    knee: 90,
    kneeBack: 80,
    ankle: 32,
    shoulderSwing: 30,
    elbow: 75,
    trunk: 4.5,
    note: 'Double march: a run, not a walk. Each foot is on the ground for only about 40% of the cycle, the swing knee folds to 90°, the elbows are carried near 75° and the trunk leans about 4.5° forward over the planted foot.',
  },
  markTime: {
    hip: 55,
    hipBack: 10,
    knee: 85,
    kneeBack: 30,
    ankle: 18,
    shoulderSwing: 0,
    elbow: 6,
    trunk: 1,
    note: 'Mark time: the thigh lifts to about 55° and the knee folds to 85°, which puts the foot about 25 cm off the ground with the toe pointed down. The stance foot stays flat and carries the weight; the arms stay at the sides with the hands closed, so the movement is all in the knee.',
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
    title: 'The knee is a hinge',
    body:
      'The knee flexes and extends in one plane and never bends backwards. At heel strike it is almost straight; during loading it flexes about 15° to absorb the impact; at toe-off it is flexing again as the foot leaves. The swing knee folds only as much as the foot needs to clear the ground. Mark time folds it to about 85° with the hip at 55°, which is a real high-knee lift rather than an impossible 90/90.',
  },
  {
    title: 'Arm swing',
    body:
      'The arm swings from the shoulder in the opposite phase to the leg on the same side: left leg forward, right arm forward. The elbow keeps a few degrees of flexion so it never locks. When a rifle or colour is carried, that arm is fixed at its grip and only the free arm swings. Double time carries the elbows near 75° and drives them harder.',
  },
  {
    title: 'Head and neck',
    body:
      'Eyes right is 45° of cervical rotation with the head level — the neck turns, the shoulders do not. The thoracic spine contributes only a few degrees, which is why a formed body keeps its dressing while looking right.',
  },
  {
    title: 'Pelvis and trunk',
    body:
      'The pelvis is not a rigid box: it rotates about 8° toward the swinging leg, lists about 4° over the stance leg and shifts 2–5 cm toward the foot carrying the weight. The shoulders counter-rotate against it, so the trunk stays square while the hips work. Double time adds about 4.5° of forward lean.',
  },
];
