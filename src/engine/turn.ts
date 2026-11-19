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
//     Check: the command foot (the pivot foot) takes a half pace, weight comes
//     onto it and the outside heel rises; the arms swing normally.
//     Pivot: cut the arms to the sides, lift the outside knee, force the body
//     90 degrees round on the ball of the pivot foot, land the outside foot,
//     then shoot the pivot foot forward half a pace.
//     Step: complete the half pace with the pivot foot and carry on.
//     The about turn on the march is two 90-degree pivots, one on each foot.
//
// The heading sign follows the renderer: facing +Z, a turn to the cadet's right
// is a negative rotation about Y. Commands are named by direction, never by the
// sign of the number, so a right turn can never silently become a left one.

import { PACE_HALF } from './constants';
import { LEG, type FootTarget } from './gait';
import { hipHeightFor } from './steps';

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
  /** A contact-fixed march turn, built from the feet at the command. */
  march?: MarchTurnPlan;
  /** A contact-fixed about turn on the march, built from the feet. */
  about?: AboutTurnPlan;
}

/** The manual's three numbered movements for a turn on the march. */
export interface MarchTurnCount {
  count: 1 | 2 | 3;
  /** check = half pace, pivot = ball pivot, step = half pace out. */
  key: 'check' | 'pivot' | 'step';
  start: number;
  end: number;
}

export interface MarchTurnPlan {
  turn: TurnPlan;
  /** The feet in the body frame at the command, before either foot moves. */
  start: { left: FootTarget; right: FootTarget };
  pivot: 'L' | 'R';
  free: 'L' | 'R';
  counts: MarchTurnCount[];
  halfPace: number;
  /** Forward travel of the pelvis over the three movements, metres. */
  advance: number;
  /** Speed the squad brings into the command, m/s, carried into count one. */
  entrySpeed: number;
}

export interface AboutTurnCount {
  count: 1 | 2 | 3 | 4 | 5;
  /** pace = left half pace; in = right foot in; pivot1/2 = ball pivots; step = left off. */
  key: 'pace' | 'in' | 'pivot1' | 'pivot2' | 'step';
  start: number;
  end: number;
}

/**
 * The manual's about turn on the march: a half pace with the free foot, the
 * command foot brought in beside it, two 90-degree ball pivots on alternate
 * feet, then a half pace off in the new direction.
 */
export interface AboutTurnPlan {
  turn: TurnPlan;
  /** The feet in the body frame at the command, before either foot moves. */
  start: { left: FootTarget; right: FootTarget };
  /** Foot forward at the command: the command foot and the first pivot. */
  lead: 'L' | 'R';
  /** Foot behind at the command: takes the opening half pace and steps off. */
  free: 'L' | 'R';
  counts: AboutTurnCount[];
  halfPace: number;
  /** Pelvis travel over the five beats, metres. */
  advance: number;
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
  { key: 'check', start: 0, end: 1 / 3, heading: 0 },
  { key: 'pivot', start: 1 / 3, end: 2 / 3, heading: 1 },
  { key: 'step', start: 2 / 3, end: 1, heading: 1 },
];

// The about turn's timing is LEFT - IN - LEFT - RIGHT - LEFT: the half pace
// and the bringing-in of the command foot occupy the first two beats, the two
// pivots the next two, and the step-off the fifth. The heading does not move
// until the right boot is in beside the left and the first ball is taken.
const ABOUT_MARCH_PHASES: TurnPhase[] = [
  { key: 'check', start: 0, end: 0.4, heading: 0 },
  { key: 'pivot1', start: 0.4, end: 0.6, heading: 0.5 },
  { key: 'pivot2', start: 0.6, end: 0.8, heading: 1 },
  { key: 'step', start: 0.8, end: 1, heading: 1 },
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
    const toeUp = 15 * Math.sin(Math.PI * Math.min(1, pivotP / 0.92));
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
      // The manual cuts the arms on the pivot and keeps the body and head
      // steady, then swings them again on the third movement. Hold the cut
      // through the turn instead of peaking for a single frame.
      const ramp = 0.16;
      armCut =
        pivotP < ramp
          ? smooth(pivotP / ramp)
          : pivotP > 1 - ramp
            ? smooth((1 - pivotP) / ramp)
            : 1;
      pulse = 0;
    }
    if (plan.context === 'aboutMarch') {
      // The manual cuts the arms as the command foot comes in on the second
      // beat and keeps them at the sides through both pivots; they swing again
      // on the step-off that resumes the march.
      armCut = clamp(smooth((p - 0.2) / 0.14) - smooth((p - 0.82) / 0.14), 0, 1);
    }
  }

  return {
    progress: p,
    phase: phase?.key ?? 'settle',
    left,
    right,
    armCut,
    // At the halt the manual says body erect, knees braced, arms at the sides;
    // on the march it says keep the body and head steady through the pivot.
    // In both cases the whole body turns as one, so no chest lead or list is
    // layered on top of the footwork.
    lean: 0,
    list: 0,
    pelvisYaw: 0,
    chestYaw: 0,
    headYaw: 0,
    shift: 0,
  };
}

// ------------------------------------------------------------ halt pivots
// The foot is a rigid boot with two ground contacts: the heel and the ball
// (MTP). In a halt turn those points do not move: the right heel is the
// right-turn fulcrum and the left ball is the other contact. The boot rotates
// about its contact, and the body centre is the midpoint of the two ankles, so
// the body shifts only by the geometry of the pivot. The closing foot then
// lifts off its ball and lands beside the pivot foot. This is what makes a
// pivot a pivot instead of a whole-body spin with skates on.

interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface TurnBody {
  /** Body centre offset from the start, in the start body frame. */
  x: number;
  z: number;
  left: FootTarget;
  right: FootTarget;
  hipY: number;
  phase: 'check' | 'pivot' | 'hold' | 'close' | 'shoot' | 'done';
}

const HEEL: V3 = { x: 0, y: -LEG.ankle, z: -LEG.heelLever };
const BALL: V3 = { x: 0, y: -LEG.ankle, z: LEG.mtp };
const PIVOT_TOE_OUT = 15;

function rotX(v: V3, deg: number): V3 {
  const a = deg * RAD;
  return { x: v.x, y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) };
}

function rotY(v: V3, deg: number): V3 {
  const a = deg * RAD;
  return { x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) };
}

/** Contact offset from the ankle in the current body frame. */
function footOffset(local: V3, yawDeg: number, pitchDeg: number): V3 {
  return rotY(rotX(local, pitchDeg), yawDeg);
}

const footYaw = (side: 'L' | 'R') => (side === 'L' ? PIVOT_TOE_OUT : -PIVOT_TOE_OUT);
const startAnkle = (side: 'L' | 'R', lateral: number = LEG.standX): V3 => ({
  x: side === 'L' ? lateral : -lateral,
  y: LEG.ankle,
  z: 0,
});

function startContact(side: 'L' | 'R', local: V3): V3 {
  const a = startAnkle(side);
  const o = footOffset(local, footYaw(side), 0);
  return { x: a.x + o.x, y: 0, z: a.z + o.z };
}

function footTarget(
  ankle: V3,
  centre: V3,
  relDeg: number,
  side: 'L' | 'R',
  pitch: number,
  toe: number,
  planted: boolean,
  contact: FootTarget['contact'],
): FootTarget {
  const local = rotY({ x: ankle.x - centre.x, y: ankle.y, z: ankle.z - centre.z }, -relDeg);
  return {
    x: local.x,
    y: ankle.y,
    z: local.z,
    pitch,
    toe,
    yaw: footYaw(side),
    planted,
    contact,
    knee: 0,
  };
}

function ankleFromContact(contact: V3, relDeg: number, yaw: number, pitch: number, local: V3): V3 {
  const o = rotY(footOffset(local, yaw, pitch), relDeg);
  return { x: contact.x - o.x, y: contact.y - o.y, z: contact.z - o.z };
}

/** World position of a boot contact for a sampled turn body. */
export function turnFootContact(
  body: TurnBody,
  relDeg: number,
  side: 'L' | 'R',
  which: 'heel' | 'ball',
): V3 {
  const foot = side === 'L' ? body.left : body.right;
  const local = which === 'heel' ? HEEL : BALL;
  const o = footOffset(local, foot.yaw, foot.pitch);
  const p = rotY({ x: foot.x + o.x, y: foot.y + o.y, z: foot.z + o.z }, relDeg);
  return { x: body.x + p.x, y: p.y, z: body.z + p.z };
}

/**
 * Real halt-turn footwork. Returns the body centre and the two ankle targets in
 * the body frame at that instant. Both boots keep a fixed world contact through
 * the pivot; the closing boot is picked up and placed beside the pivot boot.
 */
export function turnBodyAt(plan: TurnPlan, progress: number): TurnBody | null {
  if (plan.context !== 'halt') return null;
  const p = clamp(progress, 0, 1);
  const pivotPhase = plan.phases.find((x) => x.key === 'pivot');
  const closePhase = plan.phases.find((x) => x.key === 'close');
  if (!pivotPhase || !closePhase) return null;
  const pivotEnd = pivotPhase.end;
  const closeStart = closePhase.start;
  const closeEnd = closePhase.end;

  const pivotSide = plan.pivot === 'R' ? 'R' : 'L';
  const outsideSide = plan.pivot === 'R' ? 'L' : 'R';
  const pivotContact = startContact(pivotSide, HEEL);
  const outsideContact = startContact(outsideSide, BALL);
  const pivotX = pivotSide === 'L' ? LEG.standX : -LEG.standX;
  const outsideX = outsideSide === 'L' ? LEG.standX : -LEG.standX;

  const pivotP = clamp((p - pivotPhase.start) / Math.max(1e-6, pivotEnd - pivotPhase.start), 0, 1);
  const toeUp = 15 * Math.sin(Math.PI * Math.min(1, pivotP / 0.92));
  const heelUp = 15 * smooth(Math.min(1, pivotP / 0.3));
  const relEnd = plan.angle * (180 / Math.PI);

  // One sample of the pivot at a given heading and foot angles.
  const pivotPose = (relDeg: number, toe: number, heel: number) => {
    const pivotAnkle = ankleFromContact(pivotContact, relDeg, footYaw(pivotSide), -toe, HEEL);
    const outsideAnkle = ankleFromContact(outsideContact, relDeg, footYaw(outsideSide), heel, BALL);
    const centre = { x: (pivotAnkle.x + outsideAnkle.x) / 2, y: 0, z: (pivotAnkle.z + outsideAnkle.z) / 2 };
    const pivot = footTarget(
      pivotAnkle,
      centre,
      relDeg,
      pivotSide,
      -toe,
      0,
      true,
      toe > 1 ? 'heel' : 'flat',
    );
    const outside = footTarget(
      outsideAnkle,
      centre,
      relDeg,
      outsideSide,
      heel,
      heel,
      true,
      heel > 1 ? 'ball' : 'flat',
    );
    return { centre, pivotAnkle, outsideAnkle, pivot, outside };
  };

  const assembled = (centre: V3, pivot: FootTarget, outside: FootTarget, phase: TurnBody['phase']): TurnBody => {
    const left = pivotSide === 'L' ? pivot : outside;
    const right = pivotSide === 'R' ? pivot : outside;
    return {
      x: centre.x,
      z: centre.z,
      left,
      right,
      hipY: hipHeightFor(left, right),
      phase,
    };
  };

  if (p < pivotEnd) {
    const rel = plan.angle * (turnHeadingAt(plan, p) * (180 / Math.PI));
    const pose = pivotPose(rel, toeUp, heelUp);
    return assembled(pose.centre, pose.pivot, pose.outside, 'pivot');
  }

  const end = pivotPose(relEnd, 0, 15);
  if (p < closeStart) {
    return assembled(end.centre, end.pivot, end.outside, 'hold');
  }

  const c = smooth(clamp((p - closeStart) / Math.max(1e-6, closeEnd - closeStart), 0, 1));
  // Final body centre is over the midpoint of the feet: the pivot ankle plus
  // the pivot foot's own final lateral offset, expressed in the new facing.
  const finalOffset = rotY({ x: -pivotX, y: 0, z: 0 }, relEnd);
  const finalCentre = {
    x: end.pivotAnkle.x + finalOffset.x,
    z: end.pivotAnkle.z + finalOffset.z,
  };
  const outsideOffset = rotY({ x: outsideX, y: 0, z: 0 }, relEnd);
  const finalOutside = {
    x: finalCentre.x + outsideOffset.x,
    y: LEG.ankle,
    z: finalCentre.z + outsideOffset.z,
  };
  const centre = {
    x: end.centre.x + (finalCentre.x - end.centre.x) * c,
    y: 0,
    z: end.centre.z + (finalCentre.z - end.centre.z) * c,
  };
  const outsideAnkle = {
    x: end.outsideAnkle.x + (finalOutside.x - end.outsideAnkle.x) * c,
    y: end.outsideAnkle.y + (finalOutside.y - end.outsideAnkle.y) * c + 0.06 * Math.sin(Math.PI * c),
    z: end.outsideAnkle.z + (finalOutside.z - end.outsideAnkle.z) * c,
  };
  const outsidePitch = 15 * (1 - c);
  const pivot = footTarget(end.pivotAnkle, centre, relEnd, pivotSide, 0, 0, true, 'flat');
  const outside = footTarget(
    outsideAnkle,
    centre,
    relEnd,
    outsideSide,
    outsidePitch,
    outsidePitch,
    c < 0.02 || c > 0.98,
    c > 0.98 ? 'flat' : 'none',
  );
  return assembled(centre, pivot, outside, p >= closeEnd ? 'done' : 'close');
}
