// Count-by-count Lee-Enfield carriage targets, from CJCR CATO 54-04.
//
// The manual gives every rifle movement as numbered movements with a standard
// pause between them. A single blend from "slope" to "order" hides the counts
// completely: the hands slide through positions that do not exist on the
// rifle. This module stores the manual's intermediate frames and samples them
// on the manual's count schedule.
//
// CATO 54-04 (Lee Enfield):
//   SLOPE ARMS FROM THE ORDER — 3 counts
//     ONE   throw up, catch with both hands: left on the forestock, right
//           Y-grip at the small of the butt, left forearm parallel to ground;
//     TWO   rifle flat on the left shoulder, right full round grasp at the
//           small, left hand around the butt plate;
//     THREE cut the right arm to the side.
//   ORDER ARMS FROM THE SLOPE — 3 counts
//     ONE   rifle vertical on the left side at the full extent of the left
//           arm, left hand at the butt, right across at the forestock;
//     TWO   force the rifle down to the right side, left hand cuts across to
//           the muzzle, right hand below the front sight;
//     THREE cut the left hand to the side.
//   PRESENT ARMS FROM THE SLOPE — 3 counts
//     ONE   right hand seizes the small of the butt;
//     TWO   rifle perpendicular in front of the centre, left hand on the
//           sling at the magazine;
//     THREE right foot 15 cm behind the left, instep against the left heel,
//           toes 30 degrees right, rifle down to the present.
//   SLOPE ARMS FROM THE PRESENT — 2 counts
//     ONE   rifle back onto the left shoulder, both hands;
//     TWO   right foot beside the left and right arm cut to the side.

import { BEAT, STANDARD_PAUSE } from './constants';
import {
  POSTURE_HANDS,
  RIFLE,
  RIFLE_CARRIAGE,
  carriagePoint,
  lerpV,
  mixCarriage,
  type Carriage,
  type Vec3,
} from './pose';
import type { Posture, WeaponState } from './types';

export type RifleHands = { left?: number; right?: number };

export interface RifleStep {
  /** 1-based manual count. */
  count: number;
  /** Motion window, seconds from the start of the movement. */
  start: number;
  end: number;
  carriage: Carriage;
  /** Grip offsets on this frame; an absent hand is free at the side. */
  hands: RifleHands;
}

export interface RiflePlan {
  type: string;
  counts: number;
  /** Action duration including the standard pause between counts. */
  duration: number;
  from: Carriage;
  fromHands: RifleHands;
  steps: RifleStep[];
  /** Footwork the manual attaches to this carriage. */
  foot?: 'present' | 'close';
}

export interface RifleSample {
  carriage: Carriage;
  handL: Vec3;
  handR: Vec3;
  /** 0 = free at the side, 1 = gripping the rifle. */
  gripL: number;
  gripR: number;
}

const ORDER = RIFLE_CARRIAGE.order;
const SLOPE = RIFLE_CARRIAGE.slope;
const PRESENT = RIFLE_CARRIAGE.present;

/** ONE of SLOPE ARMS: caught in front of the right shoulder, both hands. */
const slopeCatch: Carriage = {
  butt: [-0.19, -0.26, 0.16],
  dir: [0.06, 0.98, 0.16],
  roll: 10,
  hands: { left: RIFLE.grip.balance, right: RIFLE.grip.small },
};

/** TWO of SLOPE ARMS: on the shoulder, right hand still at the small. */
const slopeOnShoulder: Carriage = {
  ...SLOPE,
  hands: { left: 0.02, right: RIFLE.grip.small },
};

/** THREE of SLOPE ARMS: the same frame, right hand released to the side. */
const slopeDone: Carriage = {
  ...SLOPE,
  hands: { left: 0.02 },
};

/** ONE of ORDER ARMS: vertical on the left side, both hands on it. */
const orderLeft: Carriage = {
  butt: [0.2, -0.27, 0.06],
  dir: [0, 1, 0],
  hands: { left: 0.02, right: RIFLE.grip.balance },
};

/** TWO of ORDER ARMS: forced down to the right side, left hand at the muzzle. */
const orderBothHands: Carriage = {
  ...ORDER,
  hands: { left: RIFLE.grip.muzzle, right: 0.9 },
};

/** THREE of ORDER ARMS. */
const orderDone: Carriage = {
  ...ORDER,
  hands: { right: RIFLE.grip.order },
};

/** ONE of PRESENT ARMS: right hand takes the small of the butt at the slope. */
const presentTake: Carriage = {
  ...SLOPE,
  hands: { left: 0.02, right: RIFLE.grip.small },
};

/** TWO of PRESENT ARMS: rifle perpendicular in front, left hand on the sling. */
const presentUp: Carriage = {
  butt: [-0.03, -0.32, 0.22],
  dir: [0, 1, 0],
  hands: { left: RIFLE.grip.balance, right: 0.13 },
};

/** THREE of PRESENT ARMS. */
const presentDone: Carriage = {
  ...PRESENT,
  hands: { left: RIFLE.grip.balance, right: 0.13 },
};

const fromWeapon = (weapon: WeaponState): Carriage | null =>
  weapon === 'none' ? null : RIFLE_CARRIAGE[weapon as Exclude<WeaponState, 'none'>] ?? null;

function schedule(counts: number): Array<{ start: number; end: number }> {
  return Array.from({ length: counts }, (_, i) => {
    const start = i * (BEAT + STANDARD_PAUSE);
    return { start, end: start + BEAT };
  });
}

function build(
  type: string,
  weapon: WeaponState,
  frames: Array<{ carriage: Carriage; hands: RifleHands }>,
  foot?: RiflePlan['foot'],
): RiflePlan | null {
  const from = fromWeapon(weapon);
  if (!from) return null;
  const times = schedule(frames.length);
  return {
    type,
    counts: frames.length,
    duration: times[times.length - 1].end,
    from,
    fromHands: { ...from.hands },
    steps: frames.map((f, i) => ({
      count: i + 1,
      start: times[i].start,
      end: times[i].end,
      carriage: f.carriage,
      hands: { ...f.hands },
    })),
    foot,
  };
}

/** The count plan for a rifle movement, or null if it has no count model yet. */
export function riflePlanFor(type: string, weapon: WeaponState): RiflePlan | null {
  switch (type) {
    case 'slopeArms':
      return build(
        type,
        weapon,
        [
          { carriage: slopeCatch, hands: slopeCatch.hands },
          { carriage: slopeOnShoulder, hands: slopeOnShoulder.hands },
          { carriage: slopeDone, hands: slopeDone.hands },
        ],
      );
    case 'orderArms':
      return build(
        type,
        weapon,
        [
          { carriage: orderLeft, hands: orderLeft.hands },
          { carriage: orderBothHands, hands: orderBothHands.hands },
          { carriage: orderDone, hands: orderDone.hands },
        ],
      );
    case 'presentArms':
      return build(
        type,
        weapon,
        [
          { carriage: presentTake, hands: presentTake.hands },
          { carriage: presentUp, hands: presentUp.hands },
          { carriage: presentDone, hands: presentDone.hands },
        ],
        'present',
      );
    case 'slopeFromPresent':
      return build(
        type,
        weapon,
        [
          { carriage: slopeOnShoulder, hands: slopeOnShoulder.hands },
          { carriage: slopeDone, hands: slopeDone.hands },
        ],
        'close',
      );
    default:
      return null;
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

function postureHands(posture: Posture): { left: Vec3; right: Vec3 } {
  const p = POSTURE_HANDS[posture] ?? POSTURE_HANDS.attention;
  return { left: p.left, right: p.right };
}

/**
 * Sample a carriage plan. `elapsed` is seconds into the action. Each count is a
 * beat of motion followed by the standard pause, exactly as the manual orders
 * the numbered movements.
 */
export function sampleRifle(
  plan: RiflePlan,
  elapsed: number,
  posture: Posture,
): RifleSample {
  const free = postureHands(posture);
  const t = Math.max(0, Math.min(plan.duration, elapsed));
  const first = plan.steps[0];

  // Before the first motion, and through the hold after each count, the frame
  // is the last completed count.
  let index = -1;
  if (t >= first.start) {
    index = plan.steps.findIndex((s) => t < s.start) - 1;
    if (index < 0) index = plan.steps.length - 1;
  }
  const atRest = index >= 0 && t >= plan.steps[index].end;

  if (index < 0 || atRest) {
    const step = index >= 0 ? plan.steps[index] : null;
    const carriage = step ? step.carriage : plan.from;
    const hands = step ? step.hands : plan.fromHands;
    const handAt = (side: 'left' | 'right') => {
      const along = hands[side];
      return along === undefined ? free[side] : carriagePoint(carriage, along);
    };
    return {
      carriage,
      handL: handAt('left'),
      handR: handAt('right'),
      gripL: hands.left === undefined ? 0 : 1,
      gripR: hands.right === undefined ? 0 : 1,
    };
  }

  const step = plan.steps[index];
  const previous = index === 0
    ? { carriage: plan.from, hands: plan.fromHands }
    : plan.steps[index - 1];
  const m = smooth((t - step.start) / Math.max(1e-6, step.end - step.start));
  const carriage = mixCarriage(previous.carriage, step.carriage, m) ?? step.carriage;

  const side = (which: 'left' | 'right') => {
    const a = previous.hands[which];
    const b = step.hands[which];
    if (a !== undefined && b !== undefined) {
      // Both hands on the rifle: the hand travels along the rifle with it,
      // rather than cutting through the air beside it.
      return {
        hand: carriagePoint(carriage, a + (b - a) * m),
        grip: 1,
      };
    }
    if (a !== undefined) {
      return {
        hand: lerpV(carriagePoint(previous.carriage, a), free[which], m),
        grip: 1 - m,
      };
    }
    if (b !== undefined) {
      return {
        hand: lerpV(free[which], carriagePoint(step.carriage, b), m),
        grip: m,
      };
    }
    return { hand: free[which], grip: 0 };
  };

  const l = side('left');
  const r = side('right');
  return {
    carriage,
    handL: l.hand,
    handR: r.hand,
    gripL: l.grip,
    gripR: r.grip,
  };
}
