// About turn on the march, from the manual's quick-time sequence (Ch 3).
//
// Given as the RIGHT foot is forward and on the ground:
//
//   LEFT  take a half pace with the left foot, placed flat on the ground;
//   IN    bring the right foot in to the left, straight-legged and just clear
//         of the ground, to the position of attention, cutting the right arm
//         down and the left in from the rear;
//   LEFT  pivot 90 degrees right on the BALL of the right foot, bending the
//         left knee, and lower the left foot beside the right;
//   RIGHT pivot 90 degrees right on the BALL of the left foot, bending the
//         right knee, and lower it beside the left;
//   LEFT  step off with a half pace with the left foot in the new direction.
//
// The two pivots are separate: the right ball is a fixed world contact for
// the first 90 degrees and the left ball for the second. Between them the
// boots come together at attention, so the cadet turns on their own feet and
// the squad does not wheel about its centre. The timing is LEFT - IN - LEFT -
// RIGHT - LEFT, five quick-time beats.

import { PACE_HALF } from './constants';
import { LEG, type FootTarget } from './gait';
import { hipHeightFor } from './steps';
import { turnHeadingAt, type AboutTurnPlan, type TurnBody } from './turn';
import { clamp01, lerp, smoothstep } from './util';

interface V3 {
  x: number;
  y: number;
  z: number;
}

const RAD = Math.PI / 180;

const BALL: V3 = { x: 0, y: -LEG.ankle, z: LEG.mtp };
const HEEL: V3 = { x: 0, y: -LEG.ankle, z: -LEG.heelLever };

const PACE_END = 0.2;
const IN_END = 0.4;
const PIVOT1_END = 0.6;
const PIVOT2_END = 0.8;

/** Heel raised at the middle of each ball pivot, degrees. */
const PIVOT_PITCH = 24;
/** The bent knee is picked up and lowered beside the pivot foot, metres. */
const KNEE_LIFT = 0.12;
/** The opening half pace and the closing of the right foot stay low. */
const OPEN_LIFT = 0.06;
const IN_LIFT = 0.045;
/** The step-off is shot forward with the toe just clear of the ground. */
const STEP_LIFT = 0.05;
const STEP_TOE = 10;

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

/** Ankle that puts a boot contact on the ground with this pitch/yaw. */
function ankleFromContact(contact: V3, yaw: number, pitch: number, which: V3, relDeg: number): V3 {
  const o = rotY(rotY(rotX(which, pitch), yaw), relDeg);
  return { x: contact.x - o.x, y: contact.y - o.y, z: contact.z - o.z };
}

function flat(foot: FootTarget): FootTarget {
  return { ...foot, y: LEG.ankle, pitch: 0, toe: 0, contact: 'flat', planted: true };
}

function footTarget(
  ankle: V3,
  yaw: number,
  pitch: number,
  planted: boolean,
  contact: FootTarget['contact'],
  toe = 0,
): FootTarget {
  return { x: ankle.x, y: ankle.y, z: ankle.z, pitch, toe, yaw, planted, contact, knee: 0 };
}

function local(foot: FootTarget, body: { x: number; z: number }, relDeg: number): FootTarget {
  const d = rotY({ x: foot.x - body.x, y: 0, z: foot.z - body.z }, -relDeg);
  return { ...foot, x: d.x, z: d.z, knee: 0 };
}

function mid(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number } {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

const sideSign = (side: 'L' | 'R') => (side === 'L' ? 1 : -1);
const faceYaw = (side: 'L' | 'R') => (side === 'L' ? 15 : -15);

/**
 * Build the about-turn plan from the feet at the command. The caller supplies
 * the exact boots left by the preceding march, which must finish on the right
 * foot: the about turn is given as the right foot is forward.
 */
export function makeAboutTurnPlan(
  turn: AboutTurnPlan['turn'],
  startFeet: { left: FootTarget; right: FootTarget },
): AboutTurnPlan | null {
  if (!Number.isFinite(startFeet.left.x) || !Number.isFinite(startFeet.right.x)) return null;
  const lead: 'L' | 'R' = startFeet.right.z >= startFeet.left.z ? 'R' : 'L';
  const free: 'L' | 'R' = lead === 'R' ? 'L' : 'R';
  // The command foot is forward and on the ground; the other may still be
  // swinging in from the march, so only the command foot is flattened.
  const start = {
    left: lead === 'L' ? flat(startFeet.left) : { ...startFeet.left },
    right: lead === 'R' ? flat(startFeet.right) : { ...startFeet.right },
  };
  const plan: AboutTurnPlan = {
    turn,
    start,
    lead,
    free,
    counts: [
      { count: 1, key: 'pace', start: 0, end: PACE_END },
      { count: 2, key: 'in', start: PACE_END, end: IN_END },
      { count: 3, key: 'pivot1', start: IN_END, end: PIVOT1_END },
      { count: 4, key: 'pivot2', start: PIVOT1_END, end: PIVOT2_END },
      { count: 5, key: 'step', start: PIVOT2_END, end: 1 },
    ],
    halfPace: PACE_HALF,
    advance: 0,
  };
  plan.advance = (() => {
    const end = aboutTurnBodyAt(plan, 1);
    return end ? Math.hypot(end.x, end.z) : 0;
  })();
  return plan;
}

/**
 * The body and both ankle targets at a point in the about turn, in the body
 * frame of the command. The body's `x`/`z` are the pelvis offset from where it
 * stood; the feet are body-local targets for the current heading.
 */
export function aboutTurnBodyAt(plan: AboutTurnPlan, progress: number): TurnBody | null {
  const p = clamp01(progress);
  const angleDeg = (plan.turn.angle * 180) / Math.PI;
  const relOf = (q: number) => angleDeg * turnHeadingAt(plan.turn, q);
  const leadSign = sideSign(plan.lead);
  const freeSign = sideSign(plan.free);
  const leadStart = plan.start[plan.lead === 'L' ? 'left' : 'right'];
  const freeStart = plan.start[plan.free === 'L' ? 'left' : 'right'];

  // The boots close to attention, centred on the line the cadet was marching,
  // with the half pace bringing the free boot up beside the command foot.
  const squareZ = freeStart.z + plan.halfPace;
  const squareX = (side: 'L' | 'R') => sideSign(side) * LEG.standX;
  const squareAnkle = (side: 'L' | 'R'): { x: number; y: number; z: number; pitch: number; yaw: number } => ({
    x: squareX(side),
    y: LEG.ankle,
    z: squareZ,
    pitch: 0,
    yaw: faceYaw(side),
  });
  const leadSquare = squareAnkle(plan.lead);
  const freeSquare = squareAnkle(plan.free);
  // End of the opening half pace: the pelvis has come up over the new stance.
  const bodyA = mid({ x: freeSquare.x, z: squareZ }, { x: leadStart.x, z: leadStart.z });
  // Feet together at attention.
  const bodyB = { x: 0, z: squareZ };

  const finish = (
    body: { x: number; z: number },
    leadFoot: FootTarget,
    freeFoot: FootTarget,
    phase: TurnBody['phase'],
  ): TurnBody => {
    const rel = relOf(p);
    const left = plan.lead === 'L' ? leadFoot : freeFoot;
    const right = plan.lead === 'R' ? leadFoot : freeFoot;
    const l = local(left, body, rel);
    const r = local(right, body, rel);
    return { x: body.x, z: body.z, left: l, right: r, hipY: hipHeightFor(l, r), phase };
  };

  // --------------------------------------------------------------- LEFT
  // The free boot takes its half pace and is placed flat. The command foot
  // stays planted; the body comes up over the two boots.
  if (p <= PACE_END) {
    const s = smoothstep(p / PACE_END);
    const body = { x: lerp(0, bodyA.x, s), z: lerp(0, bodyA.z, s) };
    const free = footTarget(
      {
        x: lerp(freeStart.x, freeSquare.x, s),
        y: lerp(freeStart.y, LEG.ankle, s) + OPEN_LIFT * Math.sin(Math.PI * s),
        z: lerp(freeStart.z, squareZ, s),
      },
      lerp(freeStart.yaw, faceYaw(plan.free), s),
      lerp(freeStart.pitch, 0, s),
      s <= 0 ? freeStart.planted : s >= 1,
      s <= 0 ? freeStart.contact : s >= 1 ? 'flat' : 'none',
      lerp(freeStart.toe, 0, s),
    );
    const lead = footTarget(
      { x: leadStart.x, y: LEG.ankle, z: leadStart.z },
      faceYaw(plan.lead),
      0,
      true,
      'flat',
    );
    return finish(body, lead, free, 'check');
  }

  // ---------------------------------------------------------------- IN
  // The right foot comes in beside the left, straight-legged and just clear
  // of the ground, to the position of attention.
  if (p <= IN_END) {
    const s = smoothstep((p - PACE_END) / (IN_END - PACE_END));
    const body = { x: lerp(bodyA.x, bodyB.x, s), z: lerp(bodyA.z, bodyB.z, s) };
    const lead = footTarget(
      {
        x: lerp(leadStart.x, leadSquare.x, s),
        y: LEG.ankle + IN_LIFT * Math.sin(Math.PI * s),
        z: lerp(leadStart.z, squareZ, s),
      },
      lerp(leadStart.yaw, faceYaw(plan.lead), s),
      0,
      s <= 0 || s >= 1,
      s <= 0 || s >= 1 ? 'flat' : 'none',
    );
    const free = footTarget(
      { x: freeSquare.x, y: LEG.ankle, z: squareZ },
      faceYaw(plan.free),
      0,
      true,
      'flat',
    );
    return finish(body, lead, free, 'check');
  }

  // ------------------------------------------------------------- PIVOT 1
  // First 90 degrees: the right ball is the fixed contact, the left knee is
  // bent, and the left boot is lowered beside the right at attention.
  const h = turnHeadingAt(plan.turn, p);
  const ball1 = contactOf({ ...leadSquare, yaw: faceYaw(plan.lead) }, BALL);
  /** Body, pivot foot and free ankle at a point in the first 90 degrees. */
  const pose1 = (c: number) => {
    const rel = angleDeg * 0.5 * c;
    const pitch = PIVOT_PITCH * Math.sin(Math.PI * c);
    const pivotAnkle = ankleFromContact(ball1, faceYaw(plan.lead), pitch, BALL, rel);
    const lateral = rotY({ x: leadSign * LEG.standX, y: 0, z: 0 }, rel);
    const body = { x: pivotAnkle.x - lateral.x, z: pivotAnkle.z - lateral.z };
    const freeOff = rotY({ x: freeSign * LEG.standX, y: 0, z: 0 }, rel);
    return {
      body,
      pivot: footTarget(pivotAnkle, faceYaw(plan.lead), pitch, true, pitch > 1 ? 'ball' : 'flat'),
      free: {
        x: body.x + freeOff.x,
        y: LEG.ankle + KNEE_LIFT * Math.sin(Math.PI * c),
        z: body.z + freeOff.z,
      },
    };
  };
  if (p <= PIVOT1_END) {
    const c = clamp01(h / 0.5);
    const pose = pose1(c);
    const free = footTarget(
      { x: pose.free.x, y: pose.free.y, z: pose.free.z },
      faceYaw(plan.free),
      0,
      c >= 1,
      c >= 1 ? 'flat' : 'none',
    );
    return finish(pose.body, pose.pivot, free, p >= PIVOT1_END ? 'shoot' : 'pivot');
  }

  // ------------------------------------------------------------- PIVOT 2
  // Second 90 degrees: the left ball is the fixed contact and the right boot
  // is lowered beside the left. The left ball is exactly where pivot one left
  // the left boot.
  const end1 = pose1(1);
  // The left boot has already turned with the body, so its ball contact is
  // measured from its world yaw: half the about turn plus its own toe-out.
  const ball2 = contactOf(
    {
      x: end1.free.x,
      y: LEG.ankle,
      z: end1.free.z,
      yaw: faceYaw(plan.free) + angleDeg * 0.5,
      pitch: 0,
    },
    BALL,
  );
  const c2 = clamp01((h - 0.5) / 0.5);
  const rel2 = relOf(p);
  const pitch2 = PIVOT_PITCH * Math.sin(Math.PI * c2);
  const freeAnkle2 = ankleFromContact(ball2, faceYaw(plan.free), pitch2, BALL, rel2);
  const freeLateral2 = rotY({ x: freeSign * LEG.standX, y: 0, z: 0 }, rel2);
  const body2 = { x: freeAnkle2.x - freeLateral2.x, z: freeAnkle2.z - freeLateral2.z };
  if (p <= PIVOT2_END) {
    const leadOff = rotY({ x: leadSign * LEG.standX, y: 0, z: 0 }, rel2);
    const leadAnkle = {
      x: body2.x + leadOff.x,
      y: LEG.ankle + KNEE_LIFT * Math.sin(Math.PI * c2),
      z: body2.z + leadOff.z,
    };
    const free = footTarget(freeAnkle2, faceYaw(plan.free), pitch2, true, pitch2 > 1 ? 'ball' : 'flat');
    const lead = footTarget(leadAnkle, faceYaw(plan.lead), 0, c2 >= 1, c2 >= 1 ? 'flat' : 'none');
    return finish(body2, lead, free, p >= PIVOT2_END ? 'shoot' : 'pivot');
  }

  // ---------------------------------------------------------------- LEFT
  // Step off in the new direction with a half pace of the left foot. The body
  // stays up over the new leading boot and the arms return to the swing.
  // The step-off is a half pace on the count, so the boot and the body arrive
  // together at the end of the beat, as they do in the quick march's step-off.
  const q = (p - PIVOT2_END) / (1 - PIVOT2_END);
  const bodyStep = smoothstep(q);
  const footStep = bodyStep;
  const relEnd = angleDeg;
  const endFree = ankleFromContact(ball2, faceYaw(plan.free), 0, BALL, relEnd);
  const freeLateral = rotY({ x: freeSign * LEG.standX, y: 0, z: 0 }, relEnd);
  const leadLateral = rotY({ x: leadSign * LEG.standX, y: 0, z: 0 }, relEnd);
  const stanceEnd = { x: endFree.x - freeLateral.x, z: endFree.z - freeLateral.z };
  const endLead = {
    x: stanceEnd.x + leadLateral.x,
    y: LEG.ankle,
    z: stanceEnd.z + leadLateral.z,
  };
  const forwardOff = rotY({ x: 0, y: 0, z: plan.halfPace }, relEnd);
  const freeStep = {
    x: endFree.x + forwardOff.x * footStep,
    y: LEG.ankle + STEP_LIFT * Math.sin(Math.PI * footStep),
    z: endFree.z + forwardOff.z * footStep,
  };
  const bodyEnd = {
    x: stanceEnd.x + forwardOff.x * bodyStep,
    z: stanceEnd.z + forwardOff.z * bodyStep,
  };
  const free = footTarget(
    freeStep,
    faceYaw(plan.free),
    -STEP_TOE * Math.sin(Math.PI * footStep),
    footStep >= 1,
    footStep >= 1 ? 'flat' : 'none',
  );
  const lead = footTarget(endLead, faceYaw(plan.lead), 0, true, 'flat');
  return finish(bodyEnd, lead, free, p >= 1 ? 'done' : 'shoot');
}

/** Test/readout helper: the world contact of either boot relative to the command. */
export function aboutTurnContact(
  plan: AboutTurnPlan,
  progress: number,
  side: 'L' | 'R',
  which: 'heel' | 'ball',
): V3 {
  const body = aboutTurnBodyAt(plan, progress);
  if (!body) return { x: 0, y: 0, z: 0 };
  const relDeg = (plan.turn.angle * 180) / Math.PI * turnHeadingAt(plan.turn, progress);
  const foot = side === 'L' ? body.left : body.right;
  const localPoint = rotY(rotX(which === 'heel' ? HEEL : BALL, foot.pitch), foot.yaw);
  const r = rotY({ x: foot.x + localPoint.x, y: 0, z: foot.z + localPoint.z }, relDeg);
  return { x: body.x + r.x, y: foot.y + localPoint.y, z: body.z + r.z };
}
