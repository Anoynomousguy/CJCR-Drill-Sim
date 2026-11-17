// Turn mechanics, written from the manual rather than from a rotation curve.
//
// A turn is not "rotate the body by 90 degrees". The manual breaks it down:
//
//   At the halt (Ch 2, "Turning and inclining at the halt"):
//     Movement one: turn 90 degrees, pivoting on the right heel and left toe,
//     raising the left heel and right toe. Knees braced, arms at the sides,
//     weight finishes on the right foot with the left heel off the ground.
//     Movement two: bend the left knee, straighten it in double time and place
//     the left foot beside the right.
//
//   On the march (Ch 3, "Turns and inclines on the march"):
//     Check: half pace with the outside foot, arms swing normally.
//     Pivot: cut the arms to the sides, lift the outside knee, force the
//     shoulders 90 degrees round while pivoting on the ball of the inside foot,
//     then shoot the outside foot forward half a pace.
//     Step: complete the half pace and carry on.
//     The about turn on the march is two 90-degree pivots, one on each foot.
//
// The heading sign follows the renderer: facing +Z, a turn to the cadet's right
// is a negative rotation about Y. Commands are named by direction, never by the
// sign of the number, so a right turn can never silently become a left one.

import { LEG } from './gait';

const RAD = Math.PI / 180;

export type TurnDir = 'right' | 'left';
export type TurnContext = 'halt' | 'march' | 'aboutMarch';
export type TurnPhaseKey = 'pivot' | 'close' | 'check' | 'step' | 'pivot1' | 'pivot2';

export interface TurnPhase {
  key: TurnPhaseKey;
  /** Normalized start of the movement within the action, 0..1. */
  start: number;
  /** Normalized end of the movement within the action, 0..1. */
  end: number;
  /** Fraction of the total heading reached at the end of this movement. */
  heading: number;
}

export interface TurnPlan {
  dir: TurnDir;
  context: TurnContext;
  /** Signed heading change in radians. A right turn is negative. */
  angle: number;
  /** Magnitude of the turn in degrees. */
  degrees: number;
  /** Foot that stays on the ground and does the pivoting. */
  pivot: 'L' | 'R';
  /** Foot that closes / lifts / steps. */
  outside: 'L' | 'R';
  phases: TurnPhase[];
  label: string;
}

export interface TurnFoot {
  /** Foot pitch, degrees, + = toe down. */
  pitch: number;
  /** Ankle lift above its standing height, metres. */
  lift: number;
  /** Extra yaw relative to the body, degrees. */
  yaw: number;
  planted: boolean;
  contact: 'flat' | 'heel' | 'ball' | 'toe' | 'none';
}

export interface TurnFootwork {
  progress: number;
  phase: TurnPhaseKey | 'settle';
  left: TurnFoot;
  right: TurnFoot;
  /** 0..1: how far the arms are cut to the sides (march pivots). */
  armCut: number;
  lean: number;
  list: number;
  pelvisYaw: number;
  chestYaw: number;
  headYaw: number;
  shift: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const HALT_PHASES: TurnPhase[] = [
  { key: 'pivot', start: 0, end: 0.56, heading: 1 },
  { key: 'close', start: 0.72, end: 0.98, heading: 1 },
];

const MARCH_PHASES: TurnPhase[] = [
  { key: 'check', start: 0, end: 0.28, heading: 0 },
  { key: 'pivot', start: 0.3, end: 0.66, heading: 1 },
  { key: 'step', start: 0.68, end: 0.98, heading: 1 },
];

const ABOUT_MARCH_PHASES: TurnPhase[] = [
  { key: 'check', start: 0, end: 0.2, heading: 0 },
  { key: 'pivot1', start: 0.22, end: 0.46, heading: 0.5 },
  { key: 'pivot2', start: 0.48, end: 0.72, heading: 1 },
  { key: 'step', start: 0.74, end: 0.98, heading: 1 },
];

/**
 * Build the command's turn plan. `degrees` is the magnitude; the direction is
 * explicit because the two must never be inferred from each other's sign.
 */
export function makeTurnPlan(
  context: TurnContext,
  degrees: number,
  dir: TurnDir = 'right',
): TurnPlan {
  const magnitude = Math.abs(degrees) || 90;
  const right = dir === 'right';
  return {
    dir,
    context,
    angle: (right ? -1 : 1) * magnitude * RAD,
    degrees: magnitude,
    pivot: right ? 'R' : 'L',
    outside: right ? 'L' : 'R',
    phases:
      context === 'halt'
        ? HALT_PHASES
        : context === 'aboutMarch'
          ? ABOUT_MARCH_PHASES
          : MARCH_PHASES,
    label:
      context === 'halt'
        ? `${right ? 'Right' : 'Left'} turn`
        : context === 'aboutMarch'
          ? 'About turn on the march'
          : `${right ? 'Right' : 'Left'} turn on the march`,
  };
}

export function turnPhaseAt(plan: TurnPlan, progress: number): TurnPhase | null {
  const p = clamp(progress, 0, 1);
  for (const phase of plan.phases) {
    if (p >= phase.start && p <= phase.end) return phase;
  }
  return null;
}

/** Fraction of the total heading completed at this point in the action. */
export function turnHeadingAt(plan: TurnPlan, progress: number): number {
  const p = clamp(progress, 0, 1);
  let previous = 0;
  for (const phase of plan.phases) {
    if (p <= phase.start) return previous;
    if (p >= phase.end) {
      previous = phase.heading;
      continue;
    }
    const local = smooth((p - phase.start) / Math.max(1e-6, phase.end - phase.start));
    return previous + (phase.heading - previous) * local;
  }
  return previous;
}

function baseFoot(): TurnFoot {
  return { pitch: 0, lift: 0, yaw: 0, planted: true, contact: 'flat' };
}

/**
 * Foot placement and trunk lead at a point in the command. The feet are in body
 * space; the body's own yaw is applied by the figure's group, so the pivot is a
 * real heel/toe pivot rather than a whole-foot rotation.
 */
export function turnFootwork(plan: TurnPlan, progress: number): TurnFootwork {
  const p = clamp(progress, 0, 1);
  const phase = turnPhaseAt(plan, p);
  const left = baseFoot();
  const right = baseFoot();
  const dirSign = plan.dir === 'right' ? 1 : -1;
  let armCut = 0;
  let pulse = 0;

  if (plan.context === 'halt') {
    const pivotPhase = plan.phases.find((x) => x.key === 'pivot');
    const closePhase = plan.phases.find((x) => x.key === 'close');
    const pivotP = pivotPhase
      ? clamp((p - pivotPhase.start) / Math.max(1e-6, pivotPhase.end - pivotPhase.start), 0, 1)
      : 0;
    const closeP = closePhase
      ? clamp((p - closePhase.start) / Math.max(1e-6, closePhase.end - closePhase.start), 0, 1)
      : 0;

    // Movement one: both contacts stay down. The pivot heel is the fulcrum and
    // the pivot toe comes up; the other heel comes up over its ball. The two
    // lifts are the ankle heights implied by those contacts, so the figure can
    // keep both boots grounded instead of leaving the cadet on one leg.
    // A drill pivot is a small, braced movement. An exaggerated heel raise
    // turns into a knee lift and reads as a step, so keep the toe/heel angles
    // to what the boot can do with the knee braced.
    const toeUp = 15 * Math.sin(Math.PI * clamp(pivotP / 0.92, 0, 1));
    const heelUp = 15 * smooth(Math.min(1, pivotP / 0.3));
    const pivot = plan.pivot === 'R' ? right : left;
    const outside = plan.pivot === 'R' ? left : right;
    pivot.pitch = -toeUp;
    pivot.lift = LEG.heelLever * Math.sin(toeUp * RAD);
    pivot.contact = toeUp > 1 ? 'heel' : 'flat';
    pivot.planted = true;
    outside.pitch = heelUp;
    outside.lift = LEG.ballLever * Math.sin(heelUp * RAD);
    outside.contact = heelUp > 1 ? 'ball' : 'flat';
    outside.planted = true;

    // Movement two: the outside foot is picked up and placed beside the pivot
    // foot. It does not travel forward; the body has already turned.
    if (closeP > 0) {
      const down = smooth(closeP);
      const ballRise = LEG.ballLever * Math.sin(heelUp * RAD);
      outside.lift = ballRise * (1 - down) + 0.035 * Math.sin(Math.PI * closeP);
      outside.pitch = heelUp * (1 - down);
      outside.contact = closeP > 0.1 && closeP < 0.9 ? 'none' : 'flat';
      outside.planted = closeP <= 0.1 || closeP >= 0.9;
      pivot.pitch *= 1 - down;
      pivot.lift *= 1 - down;
      pivot.contact = 'flat';
    }
    pulse = Math.sin(Math.PI * clamp(pivotP, 0, 1)) * (1 - smooth(closeP));
  } else {
    const activePivot =
      plan.context === 'aboutMarch'
        ? phase?.key === 'pivot1'
          ? plan.pivot
          : phase?.key === 'pivot2'
            ? plan.outside
            : null
        : phase?.key === 'pivot'
          ? plan.pivot
          : null;
    const pivotPhase =
      plan.context === 'aboutMarch'
        ? plan.phases.find((x) => x.key === (phase?.key === 'pivot2' ? 'pivot2' : 'pivot1'))
        : plan.phases.find((x) => x.key === 'pivot');
    const pivotP = pivotPhase
      ? clamp((p - pivotPhase.start) / Math.max(1e-6, pivotPhase.end - pivotPhase.start), 0, 1)
      : 0;

    if (activePivot) {
      const ballPitch = 24 * Math.sin(Math.PI * pivotP);
      const lifting = activePivot === 'R' ? left : right;
      const pivoting = activePivot === 'R' ? right : left;
      pivoting.pitch = ballPitch;
      pivoting.lift = LEG.ballLever * Math.sin(ballPitch * RAD);
      pivoting.contact = ballPitch > 1 ? 'ball' : 'flat';
      pivoting.planted = true;
      const kneeLift = 0.115 * Math.sin(Math.PI * pivotP);
      lifting.lift = kneeLift;
      lifting.pitch = 10 * Math.sin(Math.PI * pivotP);
      lifting.contact = kneeLift > 0.02 ? 'none' : 'flat';
      lifting.planted = kneeLift <= 0.02;
      armCut = Math.sin(Math.PI * pivotP);
      pulse = armCut;
    }
  }

  return {
    progress: p,
    phase: phase?.key ?? 'settle',
    left,
    right,
    armCut,
    lean: 4 * pulse,
    list: 6 * pulse * dirSign,
    pelvisYaw: -9 * pulse * dirSign,
    chestYaw: 14 * pulse * dirSign,
    headYaw: 22 * pulse * dirSign,
    shift: -0.022 * pulse * dirSign,
  };
}
