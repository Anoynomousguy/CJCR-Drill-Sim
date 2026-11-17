// Muscle model: where each muscle attaches, what it does, and when it fires.
//
// This is the part that makes a rig read as anatomy rather than as a puppet.
// A joint angle alone says nothing about effort. The effort is in the muscle
// activation: which muscle is shortening in which phase of the step, which one
// is working eccentrically to absorb the landing, which one is silent.
//
// Anchors are body-space points at the rest pose on the cadet's LEFT side;
// the right side mirrors X. They are converted into each bone's local space by
// the figure at build time, so a muscle stays attached to both bones as they
// move and its belly is measured every frame.
//
// Activation windows are taken from surface EMG of level walking (e.g. the
// quantified lower-limb EMG study of Ericson et al., and the phase summaries in
// Perry's gait analysis): tibialis anterior at loading and again through swing,
// soleus and gastrocnemius through stance, gluteus maximus just after heel
// strike, gluteus medius across the first half of stance, hamstrings in late
// swing and pre-swing. Phase 0 is that side's heel strike.
//
// Peak figures are typical % of maximum voluntary contraction and are carried
// for the anatomy readout; the curve itself is neural drive, 0..1.

import type { Gait } from './types';

export type Vec3 = [number, number, number];

export type MuscleBone =
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
  | 'foot';

export type Side = 'L' | 'R';

export interface MuscleAnchor {
  bone: MuscleBone;
  at: Vec3;
}

export type MuscleKey = readonly [number, number];

export interface MuscleDef {
  id: string;
  name: string;
  side: Side;
  region: 'hip' | 'thigh' | 'shank' | 'foot' | 'trunk' | 'shoulder' | 'arm' | 'neck';
  origin: MuscleAnchor;
  insertion: MuscleAnchor;
  /** A wrap point between origin and insertion, e.g. the patella. */
  via?: MuscleAnchor;
  radius: number;
  action: string;
  /** Activation through one walking cycle, keys [phase, 0..1]. */
  walk: readonly MuscleKey[];
  /** Running / double time overrides, when the timing really changes. */
  run?: readonly MuscleKey[];
  /** Typical peak activation in walking, % MVC. */
  peak: number;
}

const curve = (keys: readonly MuscleKey[], phase: number): number => {
  const p = ((phase % 1) + 1) % 1;
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i];
    if (p <= b[0]) {
      const a = keys[i - 1];
      const span = b[0] - a[0] || 1;
      const t = (p - a[0]) / span;
      const s = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * s;
    }
  }
  return keys[keys.length - 1][1];
};

// ------------------------------------------------------------- activations
// The shapes below are deliberately not sine waves: a muscle switches on for a
// job, holds while the job lasts, and lets go. That is why a real step has
// sharp loading and push-off bursts instead of a smooth rocking motion.

const GLUTE_MAX: readonly MuscleKey[] = [
  [0, 0.75], [0.05, 0.95], [0.12, 0.8], [0.22, 0.45], [0.34, 0.18],
  [0.46, 0.28], [0.55, 0.55], [0.65, 0.3], [0.8, 0.25], [0.92, 0.55], [1, 0.75],
];

const GLUTE_MED: readonly MuscleKey[] = [
  [0, 0.7], [0.08, 0.95], [0.2, 0.9], [0.32, 0.7], [0.44, 0.4],
  [0.56, 0.22], [0.7, 0.2], [0.84, 0.4], [1, 0.7],
];

const ILIOPSOAS: readonly MuscleKey[] = [
  [0, 0.12], [0.12, 0.16], [0.3, 0.2], [0.42, 0.34], [0.5, 0.6],
  [0.58, 0.88], [0.7, 0.62], [0.84, 0.3], [1, 0.12],
];

const RECTUS_FEMORIS: readonly MuscleKey[] = [
  [0, 0.6], [0.08, 0.55], [0.2, 0.3], [0.34, 0.18], [0.46, 0.3],
  [0.56, 0.5], [0.66, 0.28], [0.8, 0.18], [1, 0.6],
];

const VASTUS: readonly MuscleKey[] = [
  [0, 0.68], [0.07, 0.88], [0.18, 0.6], [0.3, 0.32], [0.44, 0.22],
  [0.56, 0.38], [0.68, 0.16], [0.82, 0.12], [0.94, 0.4], [1, 0.68],
];

const HAMSTRINGS: readonly MuscleKey[] = [
  [0, 0.6], [0.08, 0.72], [0.18, 0.4], [0.3, 0.2], [0.42, 0.22],
  [0.52, 0.48], [0.6, 0.68], [0.7, 0.45], [0.82, 0.55], [0.93, 0.85], [1, 0.6],
];

const ADDUCTORS: readonly MuscleKey[] = [
  [0, 0.5], [0.1, 0.65], [0.24, 0.42], [0.38, 0.25], [0.5, 0.32],
  [0.62, 0.48], [0.76, 0.28], [0.9, 0.36], [1, 0.5],
];

const TIBIALIS: readonly MuscleKey[] = [
  [0, 0.72], [0.06, 0.92], [0.14, 0.6], [0.24, 0.28], [0.38, 0.14],
  [0.5, 0.12], [0.6, 0.25], [0.7, 0.55], [0.82, 0.88], [0.92, 0.8], [1, 0.72],
];

const GASTROCNEMIUS: readonly MuscleKey[] = [
  [0, 0.3], [0.08, 0.42], [0.2, 0.55], [0.32, 0.68], [0.42, 0.72],
  [0.5, 0.55], [0.58, 0.5], [0.66, 0.28], [0.78, 0.2], [0.9, 0.24], [1, 0.3],
];

const SOLEUS: readonly MuscleKey[] = [
  [0, 0.42], [0.08, 0.62], [0.2, 0.82], [0.32, 0.92], [0.42, 0.9],
  [0.5, 0.68], [0.58, 0.4], [0.66, 0.18], [0.8, 0.1], [0.9, 0.2], [1, 0.42],
];

const PERONEALS: readonly MuscleKey[] = [
  [0, 0.45], [0.1, 0.7], [0.24, 0.5], [0.38, 0.38], [0.5, 0.42],
  [0.6, 0.5], [0.72, 0.24], [0.86, 0.42], [1, 0.45],
];

const ERECTORS: readonly MuscleKey[] = [
  [0, 0.42], [0.1, 0.58], [0.24, 0.4], [0.4, 0.28], [0.56, 0.32],
  [0.72, 0.38], [0.86, 0.32], [1, 0.42],
];

const ABDOMINALS: readonly MuscleKey[] = [
  [0, 0.18], [0.12, 0.26], [0.3, 0.2], [0.46, 0.22], [0.6, 0.28],
  [0.76, 0.22], [1, 0.18],
];

const OBLIQUES: readonly MuscleKey[] = [
  [0, 0.22], [0.1, 0.34], [0.26, 0.24], [0.44, 0.28], [0.58, 0.38],
  [0.72, 0.26], [0.88, 0.24], [1, 0.22],
];

const LATS: readonly MuscleKey[] = [
  [0, 0.2], [0.14, 0.3], [0.3, 0.22], [0.46, 0.26], [0.62, 0.34],
  [0.78, 0.26], [1, 0.2],
];

// The arm swings opposite the leg on its own side: at that side's heel strike
// the arm is behind, so the shoulder extensors are working and the flexors are
// lengthening. These curves are already written in that half-cycle offset.
const DELTOID_ANTERIOR: readonly MuscleKey[] = [
  [0, 0.28], [0.12, 0.2], [0.3, 0.3], [0.46, 0.6], [0.55, 0.78],
  [0.68, 0.5], [0.82, 0.3], [1, 0.28],
];

const DELTOID_POSTERIOR: readonly MuscleKey[] = [
  [0, 0.72], [0.1, 0.85], [0.24, 0.55], [0.4, 0.3], [0.54, 0.22],
  [0.7, 0.35], [0.84, 0.55], [1, 0.72],
];

const PECS: readonly MuscleKey[] = [
  [0, 0.35], [0.16, 0.28], [0.34, 0.32], [0.5, 0.48], [0.62, 0.4],
  [0.8, 0.3], [1, 0.35],
];

const ELBOW_FLEXORS: readonly MuscleKey[] = [
  [0, 0.35], [0.14, 0.28], [0.32, 0.32], [0.48, 0.55], [0.58, 0.7],
  [0.7, 0.5], [0.86, 0.35], [1, 0.35],
];

const ELBOW_EXTENSORS: readonly MuscleKey[] = [
  [0, 0.6], [0.12, 0.72], [0.28, 0.45], [0.44, 0.3], [0.6, 0.28],
  [0.76, 0.4], [0.9, 0.55], [1, 0.6],
];

const SCM: readonly MuscleKey[] = [
  [0, 0.12], [0.2, 0.16], [0.4, 0.14], [0.6, 0.18], [0.8, 0.16], [1, 0.12],
];

const RUN_VASTUS: readonly MuscleKey[] = [
  [0, 0.85], [0.06, 0.98], [0.16, 0.75], [0.28, 0.45], [0.38, 0.4],
  [0.5, 0.6], [0.62, 0.3], [0.8, 0.2], [0.94, 0.55], [1, 0.85],
];

const RUN_HAMSTRINGS: readonly MuscleKey[] = [
  [0, 0.7], [0.06, 0.85], [0.16, 0.5], [0.28, 0.3], [0.4, 0.4],
  [0.52, 0.7], [0.62, 0.85], [0.72, 0.6], [0.84, 0.7], [0.94, 0.95], [1, 0.7],
];

// --------------------------------------------------------------- definitions
interface Spec {
  id: string;
  name: string;
  region: MuscleDef['region'];
  origin: MuscleAnchor;
  insertion: MuscleAnchor;
  via?: MuscleAnchor;
  radius: number;
  action: string;
  walk: readonly MuscleKey[];
  run?: readonly MuscleKey[];
  peak: number;
  /** Extra phase offset; arms are half a cycle out from the leg on that side. */
  shift?: number;
}

const A = (bone: MuscleBone, at: Vec3): MuscleAnchor => ({ bone, at });

// Every anchor below is on the cadet's left. Coordinates are the palpable
// landmarks: ASIS, greater trochanter, femoral condyles, tibial tuberosity,
// calcaneus, acromion, medial epicondyle.
const SPECS: readonly Spec[] = [
  // ---------------------------------------------------------------- hip
  {
    id: 'gluteMax', name: 'Gluteus maximus', region: 'hip',
    origin: A('pelvis', [0.055, 0.9, -0.078]), insertion: A('thigh', [0.046, 0.63, -0.052]),
    radius: 0.036, action: 'extends and externally rotates the hip',
    walk: GLUTE_MAX, peak: 48,
  },
  {
    id: 'gluteMed', name: 'Gluteus medius', region: 'hip',
    origin: A('pelvis', [0.082, 0.952, -0.012]), insertion: A('thigh', [0.088, 0.83, -0.004]),
    radius: 0.027, action: 'holds the pelvis level over the stance leg',
    walk: GLUTE_MED, peak: 54,
  },
  {
    id: 'iliopsoas', name: 'Iliopsoas', region: 'hip',
    origin: A('pelvis', [0.032, 0.962, 0.012]), insertion: A('thigh', [0.004, 0.862, 0.033]),
    radius: 0.021, action: 'flexes the hip and controls hip extension',
    walk: ILIOPSOAS, peak: 32,
  },
  {
    id: 'tfl', name: 'Tensor fasciae latae', region: 'hip',
    origin: A('pelvis', [0.086, 0.938, 0.022]), insertion: A('shin', [0.052, 0.55, 0.02]),
    radius: 0.013, action: 'tightens the iliotibial band, abducts the hip',
    walk: GLUTE_MED, peak: 26,
  },
  // --------------------------------------------------------------- thigh
  {
    id: 'rectusFemoris', name: 'Rectus femoris', region: 'thigh',
    origin: A('pelvis', [0.058, 0.945, 0.058]), insertion: A('shin', [-0.006, 0.492, 0.058]),
    via: A('shin', [0.0, 0.505, 0.062]),
    radius: 0.024, action: 'flexes the hip and extends the knee',
    walk: RECTUS_FEMORIS, peak: 22,
  },
  {
    id: 'vastusLateralis', name: 'Vastus lateralis', region: 'thigh',
    origin: A('thigh', [0.056, 0.79, 0.02]), insertion: A('shin', [0.018, 0.5, 0.056]),
    radius: 0.028, action: 'extends the knee',
    walk: VASTUS, run: RUN_VASTUS, peak: 42,
  },
  {
    id: 'vastusMedialis', name: 'Vastus medialis', region: 'thigh',
    origin: A('thigh', [-0.032, 0.742, 0.026]), insertion: A('shin', [-0.012, 0.492, 0.056]),
    radius: 0.026, action: 'extends the knee and steadies the patella',
    walk: VASTUS, run: RUN_VASTUS, peak: 46,
  },
  {
    id: 'bicepsFemoris', name: 'Biceps femoris', region: 'thigh',
    origin: A('pelvis', [-0.048, 0.9, -0.062]), insertion: A('shin', [0.03, 0.508, -0.044]),
    radius: 0.025, action: 'extends the hip and flexes the knee',
    walk: HAMSTRINGS, run: RUN_HAMSTRINGS, peak: 34,
  },
  {
    id: 'semitendinosus', name: 'Semitendinosus', region: 'thigh',
    origin: A('pelvis', [0.034, 0.884, -0.066]), insertion: A('shin', [-0.02, 0.492, -0.03]),
    radius: 0.019, action: 'extends the hip and flexes the knee',
    walk: HAMSTRINGS, run: RUN_HAMSTRINGS, peak: 30,
  },
  {
    id: 'adductorLongus', name: 'Adductor longus', region: 'thigh',
    origin: A('pelvis', [0.022, 0.902, 0.026]), insertion: A('thigh', [0.0, 0.69, 0.012]),
    radius: 0.023, action: 'adducts the hip, steadies the pelvis',
    walk: ADDUCTORS, peak: 30,
  },
  {
    id: 'sartorius', name: 'Sartorius', region: 'thigh',
    origin: A('pelvis', [0.078, 0.934, 0.03]), insertion: A('shin', [-0.028, 0.512, 0.05]),
    radius: 0.011, action: 'flexes, abducts and externally rotates the hip',
    walk: RECTUS_FEMORIS, peak: 18,
  },
  // --------------------------------------------------------------- shank
  {
    id: 'tibialisAnterior', name: 'Tibialis anterior', region: 'shank',
    origin: A('shin', [0.024, 0.443, 0.036]), insertion: A('foot', [0.014, 0.083, 0.056]),
    radius: 0.013, action: 'dorsiflexes the ankle, controls foot slap',
    walk: TIBIALIS, peak: 39,
  },
  {
    id: 'gastrocnemius', name: 'Gastrocnemius', region: 'shank',
    origin: A('thigh', [0.022, 0.523, -0.038]), insertion: A('foot', [0.0, 0.082, -0.046]),
    radius: 0.019, action: 'plantarflexes the ankle and flexes the knee',
    walk: GASTROCNEMIUS, peak: 41,
  },
  {
    id: 'soleus', name: 'Soleus', region: 'shank',
    origin: A('shin', [0.006, 0.383, -0.036]), insertion: A('foot', [0.0, 0.077, -0.05]),
    radius: 0.017, action: 'holds the shank over the foot in stance',
    walk: SOLEUS, peak: 55,
  },
  {
    id: 'peroneusLongus', name: 'Peroneus longus', region: 'shank',
    origin: A('shin', [0.031, 0.397, -0.004]), insertion: A('foot', [0.032, 0.088, 0.024]),
    radius: 0.011, action: 'everts the foot and supports the arch',
    walk: PERONEALS, peak: 24,
  },
  // --------------------------------------------------------------- trunk
  {
    id: 'erectorSpinae', name: 'Erector spinae', region: 'trunk',
    origin: A('pelvis', [0.032, 0.928, -0.052]), insertion: A('chest', [0.03, 1.238, -0.08]),
    radius: 0.019, action: 'extends the spine and holds the trunk upright',
    walk: ERECTORS, peak: 28,
  },
  {
    id: 'rectusAbdominis', name: 'Rectus abdominis', region: 'trunk',
    origin: A('pelvis', [0.026, 0.944, 0.062]), insertion: A('chest', [0.03, 1.19, 0.094]),
    radius: 0.017, action: 'flexes the trunk, braces the abdomen',
    walk: ABDOMINALS, peak: 14,
  },
  {
    id: 'obliques', name: 'External oblique', region: 'trunk',
    origin: A('pelvis', [0.062, 0.944, 0.032]), insertion: A('chest', [0.088, 1.208, 0.064]),
    radius: 0.021, action: 'rotates and laterally flexes the trunk',
    walk: OBLIQUES, peak: 20,
  },
  {
    id: 'latissimus', name: 'Latissimus dorsi', region: 'trunk',
    origin: A('pelvis', [0.05, 0.964, -0.085]), insertion: A('upperArm', [0.192, 1.348, -0.03]),
    radius: 0.024, action: 'extends and adducts the shoulder',
    walk: LATS, peak: 22,
  },
  {
    id: 'trapezius', name: 'Trapezius', region: 'shoulder',
    origin: A('chest', [0.028, 1.428, -0.03]), insertion: A('clav', [0.17, 1.418, -0.028]),
    radius: 0.018, action: 'elevates and retracts the shoulder girdle',
    walk: ERECTORS, peak: 24,
  },
  // -------------------------------------------------------------- shoulder
  {
    id: 'pectoralis', name: 'Pectoralis major', region: 'shoulder',
    origin: A('chest', [0.042, 1.31, 0.108]), insertion: A('upperArm', [0.196, 1.336, 0.02]),
    radius: 0.026, action: 'flexes and adducts the arm',
    walk: PECS, shift: 0.5, peak: 26,
  },
  {
    id: 'deltoidAnterior', name: 'Deltoid, anterior', region: 'shoulder',
    origin: A('clav', [0.196, 1.418, 0.018]), insertion: A('upperArm', [0.2, 1.318, 0.008]),
    radius: 0.019, action: 'raises the arm forward',
    walk: DELTOID_ANTERIOR, shift: 0.5, peak: 28,
  },
  {
    id: 'deltoidPosterior', name: 'Deltoid, posterior', region: 'shoulder',
    origin: A('chest', [0.186, 1.402, -0.056]), insertion: A('upperArm', [0.2, 1.318, -0.014]),
    radius: 0.017, action: 'swings the arm back',
    walk: DELTOID_POSTERIOR, shift: 0.5, peak: 30,
  },
  // ------------------------------------------------------------------- arm
  {
    id: 'bicepsBrachii', name: 'Biceps brachii', region: 'arm',
    origin: A('upperArm', [0.2, 1.393, 0.026]), insertion: A('foreArm', [0.2, 1.168, 0.024]),
    radius: 0.016, action: 'flexes the elbow and supinates the forearm',
    walk: ELBOW_FLEXORS, shift: 0.5, peak: 26,
  },
  {
    id: 'tricepsBrachii', name: 'Triceps brachii', region: 'arm',
    origin: A('upperArm', [0.2, 1.395, -0.034]), insertion: A('foreArm', [0.2, 1.158, -0.03]),
    radius: 0.015, action: 'extends the elbow',
    walk: ELBOW_EXTENSORS, shift: 0.5, peak: 24,
  },
  {
    id: 'brachioradialis', name: 'Brachioradialis', region: 'arm',
    origin: A('upperArm', [0.2, 1.212, 0.038]), insertion: A('hand', [0.2, 0.902, 0.008]),
    radius: 0.011, action: 'flexes the elbow with the forearm neutral',
    walk: ELBOW_FLEXORS, shift: 0.5, peak: 18,
  },
  // ------------------------------------------------------------------ neck
  {
    id: 'sternocleidomastoid', name: 'Sternocleidomastoid', region: 'neck',
    origin: A('chest', [0.03, 1.404, 0.05]), insertion: A('head', [0.042, 1.548, 0.024]),
    radius: 0.009, action: 'turns and flexes the head',
    walk: SCM, peak: 12,
  },
];

/** Mirror a left-side anchor across the midline. */
export const mirror = (at: Vec3): Vec3 => [-at[0], at[1], at[2]];

function makeSide(spec: Spec, side: Side): MuscleDef {
  const flip = (anchor: MuscleAnchor): MuscleAnchor =>
    side === 'L' ? anchor : { bone: anchor.bone, at: mirror(anchor.at) };
  return {
    id: `${spec.id}.${side}`,
    name: spec.name,
    side,
    region: spec.region,
    origin: flip(spec.origin),
    insertion: flip(spec.insertion),
    via: spec.via ? flip(spec.via) : undefined,
    radius: spec.radius,
    action: spec.action,
    walk: spec.walk,
    run: spec.run,
    peak: spec.peak,
  };
}

/** Every muscle, both sides, in a stable order. */
export const MUSCLES: readonly MuscleDef[] = SPECS.flatMap((spec) => [
  makeSide(spec, 'L'),
  makeSide(spec, 'R'),
]);

/**
 * Activation for one muscle. `cycle` is the gait phase of that side: 0 at its
 * heel strike. The arm curves are already written half a cycle out of phase
 * with the leg on the same side, which is what makes a gait contralateral.
 */
export function muscleActivationFor(def: MuscleDef, gait: Gait, cycle: number): number {
  if (gait === 'halt') return 0.04;
  const keys = gait === 'double' && def.run ? def.run : def.walk;
  return clamp01(curve(keys, cycle));
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export interface ActiveMuscle {
  def: MuscleDef;
  activation: number;
}

/**
 * Muscles working hardest at this instant, for the anatomy readout. Sorted by
 * activation so the list always names the prime movers of the pose.
 */
export function activeMuscles(gait: Gait, cycle: number, side: Side, limit = 5): ActiveMuscle[] {
  return MUSCLES.filter((m) => m.side === side)
    .map((def) => ({ def, activation: muscleActivationFor(def, gait, cycle) }))
    .sort((a, b) => b.activation - a.activation)
    .slice(0, limit);
}
