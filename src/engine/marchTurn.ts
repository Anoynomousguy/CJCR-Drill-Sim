// Contact-fixed turns on the march, from the manual's three numbered
// movements.
//
// A right turn is given as the LEFT foot is forward and on the ground. The
// cadet then:
//   ONE   takes a half pace forward with the RIGHT foot, weight onto it, left
//         heel raised;
//   TWO   cuts the arms to the sides, bends the LEFT knee, pivots 90 degrees
//         right on the BALL of the right foot, straightens the left leg and
//         lands the left foot, then shoots the right foot forward half a pace;
//   THREE completes the half pace with the right foot and marches on.
// The left turn is the mirror, given on the right foot.
//
// The turn is executed by each cadet, not by sliding the formation round a
// pivot. The pivot boot's ball is a fixed world contact for the whole pivot:
// the body rotates about it, the free knee lifts and the free foot lands, and
// only then does the pivot foot leave its ball and step out. That is the
// precision that makes twelve individual turns read as one movement: every
// cadet has the same three count frames and the same contacts, even though the
// bodies are separate.

import { BEAT, PACE_HALF } from './constants';
import { LEG, type FootTarget } from './gait';
import { hipHeightFor } from './steps';
import { turnHeadingAt, type MarchTurnPlan, type TurnBody, type TurnPlan } from './turn';
import { clamp01, smoothstep } from './util';

interface V3 {
  x: number;
  y: number;
  z: number;
}

const RAD = Math.PI / 180;

const BALL: V3 = { x: 0, y: -LEG.ankle, z: LEG.mtp };
const HEEL: V3 = { x: 0, y: -LEG.ankle, z: -LEG.heelLever };
const CHECK_END = 1 / 3;
const PIVOT_END = 2 / 3;

function rotX(v: V3, deg: number): V3 {
  const a = deg * RAD;
  return { x: v.x, y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) };
}

function rotY(v: V3, deg: number): V3 {
  const a = deg * RAD;
  return { x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) };
}

/** World contact of a boot heel/ball from its ankle, yaw and pitch. */
function contactOf(foot: Pick<FootTarget, 'x' | 'y' | 'z' | 'yaw' | 'pitch'>, which: V3): V3 {
  const o = rotY(rotX(which, foot.pitch), foot.yaw);
  return { x: foot.x + o.x, y: foot.y + o.y, z: foot.z + o.z };
}

/**
 * Ankle that puts the given boot contact on the ground with this pitch/yaw,
 * expressed in a body frame `rel` degrees round from the contact frame.
 */
function ankleFromContact(contact: V3, yaw: number, pitch: number, which: V3, relDeg = 0): V3 {
  const o = rotY(rotY(rotX(which, pitch), yaw), relDeg);
  return { x: contact.x - o.x, y: contact.y - o.y, z: contact.z - o.z };
}

function flat(foot: FootTarget): FootTarget {
  return { ...foot, y: LEG.ankle, pitch: 0, toe: 0, contact: 'flat', planted: true, knee: 0 };
}

function footTarget(
  ankle: V3,
  yaw: number,
  pitch: number,
  planted: boolean,
  contact: FootTarget['contact'],
): FootTarget {
  return {
    x: ankle.x,
    y: ankle.y,
    z: ankle.z,
    pitch,
    toe: 0,
    yaw,
    planted,
    contact,
    knee: 0,
  };
}

function local(foot: FootTarget, body: V3, relDeg: number): FootTarget {
  const d = rotY({ x: foot.x - body.x, y: 0, z: foot.z - body.z }, -relDeg);
  return { ...foot, x: d.x, z: d.z, knee: 0 };
}

function mid(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number } {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function swingAnkle(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, t: number, lift: number): V3 {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t) + lift * Math.sin(Math.PI * t),
    z: lerp(from.z, to.z, t),
  };
}

const sideSign = (side: 'L' | 'R') => (side === 'L' ? 1 : -1);
const toeOutYaw = (side: 'L' | 'R') => (side === 'L' ? 15 : -15);

/**
 * Build the march-turn plan from the feet at the command. The caller supplies
 * the exact boots left by the preceding march, so the command lands on the
 * foot the manual names.
 */
export function makeMarchTurnPlan(
  turn: TurnPlan,
  startFeet: { left: FootTarget; right: FootTarget },
  entrySpeed = 1.5,
): MarchTurnPlan | null {
  const pivot = turn.pivot;
  const free = turn.outside;
  const start = {
    left: pivot === 'L' ? { ...startFeet.left } : flat(startFeet.left),
    right: pivot === 'R' ? { ...startFeet.right } : flat(startFeet.right),
  };
  if (!Number.isFinite(start.left.x) || !Number.isFinite(start.right.x)) return null;
  const plan: MarchTurnPlan = {
    turn,
    start,
    pivot,
    free,
    counts: [
      { count: 1, key: 'check', start: 0, end: CHECK_END },
      { count: 2, key: 'pivot', start: CHECK_END, end: PIVOT_END },
      { count: 3, key: 'step', start: PIVOT_END, end: 1 },
    ],
    halfPace: PACE_HALF,
    advance: 0,
    entrySpeed,
  };
  plan.advance = Math.hypot(marchTurnBodyAt(plan, 1)?.x ?? 0, marchTurnBodyAt(plan, 1)?.z ?? 0);
  return plan;
}

/**
 * The body and both ankle targets at a point in the three-movement turn.
 * Everything is expressed in the body frame of the command, so `x`/`z` are the
 * pelvis offset from where it stood and the feet are the current body's local
 * targets. The body heading is the turn's heading at this progress.
 */
export function marchTurnBodyAt(plan: MarchTurnPlan, progress: number): TurnBody | null {
  const p = clamp01(progress);
  const relDeg = (plan.turn.angle * 180) / Math.PI * turnHeadingAt(plan.turn, p);
  const pivotStart = plan.start[plan.pivot === 'L' ? 'left' : 'right'];
  const freeStart = plan.start[plan.free === 'L' ? 'left' : 'right'];
  const freeFlat = flat(freeStart);
  const freeBall = contactOf(freeFlat, BALL);
  const pivotPlant = {
    ...pivotStart,
    z: pivotStart.z + plan.halfPace,
    y: LEG.ankle,
    pitch: 0,
    toe: 0,
    contact: 'flat' as const,
    planted: true,
  };
  const pivotBall = contactOf(pivotPlant, BALL);
  const startMid = mid(freeFlat, pivotStart);
  // Count one ends with the free boot at 18 degrees of heel raise and the
  // pivot boot planted, so this is where the body would naturally settle.
  const freeCheckEnd = footTarget(
    ankleFromContact(freeBall, freeStart.yaw, 18, BALL),
    freeStart.yaw,
    18,
    false,
    'none',
  );
  const settleCheckEnd = mid(freeCheckEnd, pivotPlant);
  const naturalCheck = {
    x: settleCheckEnd.x - startMid.x,
    z: settleCheckEnd.z - startMid.z,
  };
  // A squad that is marching into the command does not stop dead on the
  // command word: it brings its forward speed into the half pace and bleeds it
  // off over the count. The pelvis therefore travels half a beat at the entry
  // speed (v*T/2 under a linear deceleration) instead of only the geometric
  // midpoint shift. The extra can never be negative: if the feet already move
  // that far, they set the path.
  const entryTravel = plan.entrySpeed * BEAT * 0.5;
  const checkTarget = {
    x: naturalCheck.x,
    z: Math.max(naturalCheck.z, entryTravel),
  };

  const finish = (body: { x: number; z: number }, left: FootTarget, right: FootTarget, phase: TurnBody['phase']): TurnBody => {
    const l = local(left, { x: body.x, y: 0, z: body.z }, relDeg);
    const r = local(right, { x: body.x, y: 0, z: body.z }, relDeg);
    return {
      x: body.x,
      z: body.z,
      left: l,
      right: r,
      hipY: hipHeightFor(l, r),
      phase,
    };
  };

  // The body's path is keyed to the three count boundaries, not to the
  // midpoint of the boots. A marching squad does not stop at the check or the
  // pivot: the manual says the three movements are "one continuous movement
  // and the cadence is maintained". The keys are the check position, the body
  // over the landed free foot at the pivot exit, and the completed half pace.
  const pivotPitchAt = (c: number) => 24 * Math.min(1, Math.max(0, c / 0.14));
  const relEnd = (plan.turn.angle * 180) / Math.PI;
  // The free boot lands half a pace ahead in the new direction, not beside
  // the pivot boot. Landing it on the pivot ball stacked both boots under the
  // pelvis, and the squad stood still for the whole of count two: the pivot
  // read as a hesitation. A turn on the march keeps marching, so the new
  // stance has to open in front of the body and carry it through the pivot.
  const freeLanding = (() => {
    const endAnkle = ankleFromContact(pivotBall, pivotStart.yaw, 24, BALL, relEnd);
    // The free boot clears the pivot by a hand's width and opens the new stance
    // a half pace into the turn; both offsets are rotations of the same frame.
    const offset = rotY({ x: sideSign(plan.free) * 0.04, y: 0, z: plan.halfPace }, relEnd);
    return footTarget(
      { x: endAnkle.x + offset.x, y: LEG.ankle, z: endAnkle.z + offset.z },
      freeStart.yaw,
      0,
      true,
      'flat',
    );
  })();
  const pivotFootAt = (c: number, rel: number): FootTarget => {
    const pitch = pivotPitchAt(c);
    const ankle = ankleFromContact(pivotBall, pivotStart.yaw, pitch, BALL, rel);
    return footTarget(ankle, pivotStart.yaw, pitch, true, pitch > 1 ? 'ball' : 'flat');
  };
  const pivotStart3 = pivotFootAt(1, relEnd);
  const forward = {
    x: Math.sin((relEnd * Math.PI) / 180),
    z: Math.cos((relEnd * Math.PI) / 180),
  };
  // The body finishes the pivot over the boot it has just landed, a hand's
  // width behind its ankle, not midway between the two boots: the weight has
  // to be on the new stance before the trailing boot can shoot forward.
  const body2Abs = {
    x: freeLanding.x - forward.x * 0.06,
    z: freeLanding.z - forward.z * 0.06,
  };
  const body2 = { x: body2Abs.x - startMid.x, z: body2Abs.z - startMid.z };
  const freeLocal = local(freeLanding, { x: body2Abs.x, y: 0, z: body2Abs.z }, relEnd);
  const rightLocal = {
    x: freeLocal.x + (plan.free === 'L' ? -0.08 : 0.08),
    z: freeLocal.z + plan.halfPace,
  };
  const landingWorld = (() => {
    const r = rotY({ x: rightLocal.x, y: 0, z: rightLocal.z }, relEnd);
    return footTarget(
      { x: body2Abs.x + r.x, y: LEG.ankle, z: body2Abs.z + r.z },
      toeOutYaw(plan.pivot),
      0,
      true,
      'flat',
    );
  })();
  const endMidAbs = mid(freeLanding, landingWorld);
  const endAbs = {
    x: endMidAbs.x + forward.x * plan.halfPace * 0.5,
    z: endMidAbs.z + forward.z * plan.halfPace * 0.5,
  };
  const end = { x: endAbs.x - startMid.x, z: endAbs.z - startMid.z };

  // ---------------------------------------------------------------- ONE
  // The pivot foot takes its half pace; the other foot is the support and its
  // heel comes up over a fixed ball contact. The body keeps moving at the
  // half-pace speed through the count: it does not decelerate to zero on the
  // command's check.
  if (p <= CHECK_END) {
    const s = p / CHECK_END;
    const u = smoothstep(s);
    const freePitch = 18 * u;
    const freeAnkle = ankleFromContact(freeBall, freeStart.yaw, freePitch, BALL);
    const free = footTarget(freeAnkle, freeStart.yaw, freePitch, true, freePitch > 1 ? 'ball' : 'flat');
    const pivotAnkle = swingAnkle(pivotStart, pivotPlant, u, 0.06);
    const pivotPlanted = (u === 0 && pivotStart.planted) || u >= 1;
    const pivot = footTarget(
      pivotAnkle,
      pivotStart.yaw,
      lerp(pivotStart.pitch, 0, u),
      pivotPlanted,
      pivotPlanted ? 'flat' : u === 0 ? pivotStart.contact : 'none',
    );
    const body = { x: checkTarget.x * s, z: checkTarget.z * s };
    return finish(body, plan.pivot === 'L' ? pivot : free, plan.pivot === 'R' ? pivot : free, p >= CHECK_END ? 'pivot' : 'check');
  }

  // -------------------------------------------------------------- TWO
  // The body turns about the fixed pivot ball; the free knee lifts and the
  // free foot lands. The body keeps moving from the check to the landing at a
  // constant speed, starting from the free boot's raised check pose.
  if (p <= PIVOT_END) {
    const q = (p - CHECK_END) / (PIVOT_END - CHECK_END);
    const c = smoothstep(q);
    const pivot = pivotFootAt(c, relDeg);
    // The outside boot skims the ground through the pivot. The manual lifts
    // the outside knee, but a 13 cm clearance folded the knee to ~68 degrees
    // with the thigh at 40, so the pivot read as a march step instead of a
    // turn. Five centimetres clears the boot without folding the leg up.
    const ankle = swingAnkle(freeCheckEnd, freeLanding, c, 0.05);
    const liftPitch = lerp(18, 0, c);
    const free = footTarget(ankle, freeStart.yaw, liftPitch, c >= 1, c >= 1 ? 'flat' : 'none');
    // The geometric midpoint of the two boots can barely move on a left
    // turn, and following it made the body crawl while the feet were still
    // pivoting. The body instead covers the fixed check-to-landing displacement
    // at a constant speed: the pivot is one third of the movement and one
    // third of its duration, so this speed matches the check and the step-out
    // at both joins and the cadence never dips.
    const body = {
      x: lerp(checkTarget.x, body2.x, q),
      z: lerp(checkTarget.z, body2.z, q),
    };
    return finish(body, plan.pivot === 'L' ? pivot : free, plan.pivot === 'R' ? pivot : free, p >= PIVOT_END ? 'shoot' : 'pivot');
  }

  // ------------------------------------------------------------ THREE
  // The free foot is down. The pivot foot leaves its ball and shoots half a
  // pace forward in the new direction; the body travels over the planted free
  // foot until the shot foot lands. The shot segment accelerates from the
  // half-pace speed to the marching speed, so the next march has no seam pop.
  const s3 = (p - PIVOT_END) / (1 - PIVOT_END);
  const c = smoothstep(s3);
  const pivotSwing = swingAnkle(pivotStart3, landingWorld, c, 0.075);
  const pivot = footTarget(pivotSwing, pivotStart.yaw, lerp(24, 0, c), c >= 1, c >= 1 ? 'flat' : 'none');
  const distance = Math.max(1e-6, Math.hypot(end.x - body2.x, end.z - body2.z));
  const v0 = (0.75 * BEAT) / distance;
  const v1 = (1.5 * BEAT) / distance;
  const s2 = s3 * s3;
  const s3c = s2 * s3;
  const q = (s3c - 2 * s2 + s3) * v0 + (-2 * s3c + 3 * s2) + (s3c - s2) * v1;
  const body = { x: lerp(body2.x, end.x, q), z: lerp(body2.z, end.z, q) };
  return finish(body, plan.pivot === 'L' ? pivot : freeLanding, plan.pivot === 'R' ? pivot : freeLanding, p >= 1 ? 'done' : 'shoot');
}

/** Test/readout helper: the world contacts of the turn relative to the command. */
export function marchTurnContact(
  plan: MarchTurnPlan,
  progress: number,
  side: 'L' | 'R',
  which: 'heel' | 'ball',
): V3 {
  const body = marchTurnBodyAt(plan, progress);
  if (!body) return { x: 0, y: 0, z: 0 };
  const relDeg = (plan.turn.angle * 180) / Math.PI * turnHeadingAt(plan.turn, progress);
  const foot = side === 'L' ? body.left : body.right;
  const localPoint = rotY(rotX(which === 'heel' ? HEEL : BALL, foot.pitch), foot.yaw);
  const r = rotY({ x: foot.x + localPoint.x, y: 0, z: foot.z + localPoint.z }, relDeg);
  return { x: body.x + r.x, y: foot.y + localPoint.y, z: body.z + r.z };
}
