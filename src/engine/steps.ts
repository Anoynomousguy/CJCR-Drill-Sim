// Explicit footwork for movements executed at the halt.
//
// A "step plan" is a list of plants for each foot, in the soldier's own body
// frame at the start of the movement. A plant is a world (body-start) position
// the ankle occupies from `land` until `lift`; while it is down the body may
// translate across it, so the foot's body-space position is the plant minus the
// body's displacement. That is the whole anti-skating rule: a planted foot has
// one world position, and only its local coordinate changes.
//
// The hip height is not a constant. A foot 35 cm forward of the pelvis cannot
// be reached by an 87 cm leg while the pelvis stays at its standing height, so
// the stance leg solves the pelvis height, exactly as the walking gait does.
// Without that, the IK clamps and the foot floats instead of planting.
//
// Timing is in beats of quick time (0.5 s). The manual's movements at the halt
// are counted "one, one-two", so a pace is a beat, and the close is the second
// half of the final beat.

import { PACE, PACE_HALF, PACE_SIDE } from './constants';
import { LEG, REACH, type FootTarget } from './gait';
import { clamp01, smoothstep } from './util';

export type StepFoot = 'L' | 'R';
export interface Vec2 {
  x: number;
  z: number;
}

export interface StepPlant {
  /** Ankle position when planted, in the body frame at the start. */
  x: number;
  z: number;
  /** Fraction of the action at which the foot lands. */
  land: number;
  /** Fraction at which it leaves for the next plant; null = stays down. */
  lift: number | null;
  /** Peak ankle clearance during the swing to this plant, metres. */
  liftHeight: number;
  /** The manual movement this plant completes. */
  label: string;
  /** Foot yaw relative to the body; default is the drill toe-out for that side. */
  yaw?: number;
  /** Ankle height when planted; default is the standing ankle height. */
  y?: number;
  /** Foot pitch when planted, degrees, + = toe down. */
  pitch?: number;
  /** Ground contact when planted; default flat. */
  contact?: FootTarget['contact'];
}

export type StepKind = 'paces' | 'side' | 'open' | 'close' | 'halt' | 'dress' | 'fallIn' | 'present' | 'march' | 'changeStep';

export interface StepPlan {
  kind: StepKind;
  /** Body displacement over the action, in the body frame at the start. */
  total: Vec2;
  /** Fraction of the action over which the body travels; the close holds still. */
  moveEnd: number;
  left: StepPlant[];
  right: StepPlant[];
  start: { left: Vec2; right: Vec2 };
  /** Commanded paces (0 for a dress). */
  paces: number;
  lead: StepFoot;
  /** Manual counts, including the closing movement. */
  counts: number;
  /** The named movements in order, for tests and the readout. */
  movements: string[];
  /**
   * Body displacement in the start frame, metres. Most plans travel straight
   * from zero to `total`; the right-dress check pace and the step-off from a
   * halt need their own path.
   */
  bodyAt?: (raw: number) => Vec2;
  /**
   * Precomputed pelvis heights, evenly spaced over the action. The pelvis has
   * mass: when a swinging boot releases the leg-reach cap, the body does not
   * snap up to the newly available height. The curve is the reach cap passed
   * through a rise limiter, so it always stays low enough for both feet while
   * giving the weight transfer a few frames to happen.
   */
  hipCurve?: Float32Array;
  /** Ease any stance heel back to the ground at the last frame (into a turn). */
  flatEnd?: boolean;
  /**
   * Arm-hold factor over the action, 0..1. CHANGE STEP cuts the arms to the
   * sides on count two and picks the swing up again on count three.
   */
  armsAt?: (raw: number) => number;
  /**
   * Pace intervals the action covers. A march that must hand over on the other
   * foot takes one extra footfall, and therefore half an interval more time
   * and half a pace more ground than its ordered paces.
   */
  beats?: number;
}

export interface StepSample {
  left: FootTarget;
  right: FootTarget;
  hipY: number;
  planted: { left: boolean; right: boolean };
  /** The movement each foot is doing right now. */
  phase: { left: string; right: string };
  /** Body displacement in the start frame, metres. */
  body: Vec2;
}

/** Pelvis height with the feet at attention. */
export const STAND_HIP =
  Math.sqrt(REACH * REACH - (LEG.hipX - LEG.standX) ** 2) + LEG.ankle;

const same = (a: Vec2): Vec2 => ({ x: a.x, z: a.z });

function initial(
  side: StepFoot,
  x = side === 'L' ? LEG.standX : -LEG.standX,
  z = 0,
  yaw = side === 'L' ? 15 : -15,
): StepPlant {
  return { x, z, land: 0, lift: null, liftHeight: 0, label: 'stand', yaw };
}

function push(list: StepPlant[], plant: StepPlant, swingStart: number) {
  const previous = list[list.length - 1];
  previous.lift = previous.land === 0 && plant.land > 0 ? Math.max(0, swingStart) : swingStart;
  list.push(plant);
}

const opposite = (foot: StepFoot): StepFoot => (foot === 'L' ? 'R' : 'L');

const RAD = Math.PI / 180;
const BALL = { z: LEG.mtp, y: -LEG.ankle };

function rotY(v: Vec2, deg: number): Vec2 {
  const a = deg * RAD;
  return { x: v.x * Math.cos(a) + v.z * Math.sin(a), z: -v.x * Math.sin(a) + v.z * Math.cos(a) };
}

/**
 * How far a stance heel has come off the ground, degrees. The foot rolls about
 * its ball once the ball is behind the pelvis: a boot held flat a whole pace
 * behind the body needs a 0.75 m reach from a 0.87 m leg, which folds the knee
 * and makes the whole squad squat. The ball stays where it was planted; the
 * ankle rises as the heel comes up, exactly as it does in the marching gait.
 */
const HEEL_MAX = 38;
const HEEL_FROM = 0.09;
const HEEL_SPAN = 0.33;

function stanceHeel(plant: StepPlant, body: Vec2, side: StepFoot): number {
  const yaw = plant.yaw ?? (side === 'L' ? 15 : -15);
  const ball = rotY({ x: 0, z: LEG.mtp }, yaw);
  const ballZ = plant.z + ball.z;
  const behind = -(ballZ - body.z);
  return HEEL_MAX * smoothstep(clamp01((behind - HEEL_FROM) / HEEL_SPAN));
}

/** Ankle and boot pose for a plant with its heel `heel` degrees off the ground. */
function heelPose(
  plant: StepPlant,
  body: Vec2,
  side: StepFoot,
  heel: number,
): FootTarget {
  const yaw = plant.yaw ?? (side === 'L' ? 15 : -15);
  const ball = rotY({ x: 0, z: LEG.mtp }, yaw);
  const ballWorld = { x: plant.x + ball.x, z: plant.z + ball.z };
  const a = heel * RAD;
  const rotated = rotY(
    { x: 0, z: BALL.y * Math.sin(a) + BALL.z * Math.cos(a) },
    yaw,
  );
  const ankle = {
    x: ballWorld.x - rotated.x,
    y: -(BALL.y * Math.cos(a) - BALL.z * Math.sin(a)),
    z: ballWorld.z - rotated.z,
  };
  return {
    x: ankle.x - body.x,
    y: ankle.y,
    z: ankle.z - body.z,
    pitch: heel,
    toe: heel * 0.25,
    yaw,
    planted: true,
    contact: 'ball',
    knee: 0,
  };
}

// ------------------------------------------------------------------ builders

/**
 * Paces forward / to the rear / open and close order.
 *
 * The leading foot takes `paces` half paces; the other foot closes on the last
 * one. Both a pace forward and a step back lead with the LEFT foot; only the
 * feet's direction changes (A-DH-201-000 Ch 2, paras 71-78). The body travels
 * during the paces and holds still for the closing movement, which is why the
 * count timing is "one, one, one-two".
 */
export function makePacesPlan(opts: {
  paces: number;
  total: Vec2;
  kind?: StepKind;
  labels?: string[];
}): StepPlan | null {
  const paces = Math.max(1, Math.round(opts.paces));
  const { total } = opts;
  if (Math.hypot(total.x, total.z) < 0.02) return null;
  const forward = total.z;
  const dir = forward === 0 ? 1 : Math.sign(forward);
  const half = Math.abs(forward) / paces;
  const actionBeats = paces + 1;
  // The manual starts both a pace forward and a step back with the LEFT foot;
  // only the direction of travel changes (Ch 2, paras 71-78).
  const lead: StepFoot = 'L';
  const start = {
    left: { x: LEG.standX, z: 0 },
    right: { x: -LEG.standX, z: 0 },
  };
  const left = [initial('L')];
  const right = [initial('R')];
  const labels =
    opts.labels ??
    (opts.kind === 'open' || opts.kind === 'close'
      ? ['one', 'two', 'three', 'close']
      : Array.from({ length: paces }, (_, i) => `pace ${i + 1}`).concat('close'));

  for (let i = 0; i < paces; i += 1) {
    const foot = i % 2 === 0 ? lead : opposite(lead);
    const contact = 0.5 + i;
    const swingStart = Math.max(0, contact - 0.45);
    const list = foot === 'L' ? left : right;
    push(
      list,
      {
        x: foot === 'L' ? LEG.standX : -LEG.standX,
        z: dir * half * (i + 1),
        land: contact / actionBeats,
        lift: null,
        liftHeight: half > 0.6 ? 0.09 : 0.06,
        label: labels[i] ?? `pace ${i + 1}`,
      },
      swingStart / actionBeats,
    );
  }

  const lastFoot: StepFoot = (paces - 1) % 2 === 0 ? lead : opposite(lead);
  const closeFoot = opposite(lastFoot);
  const closeList = closeFoot === 'L' ? left : right;
  const closeContact = paces + 0.5;
  const closeStart = paces + 0.1;
  push(
    closeList,
    {
      x: closeFoot === 'L' ? LEG.standX : -LEG.standX,
      z: dir * half * paces,
      land: closeContact / actionBeats,
      lift: null,
      liftHeight: 0.055,
      label: labels[paces] ?? 'close',
    },
    closeStart / actionBeats,
  );

  return {
    kind: opts.kind ?? 'paces',
    total: { x: 0, z: dir * half * paces },
    moveEnd: paces / actionBeats,
    left,
    right,
    start,
    paces,
    lead,
    counts: paces + 1,
    movements: labels,
  };
}

/**
 * Closing to the right or left: one 25 cm side pace, the other foot closing,
 * arms still at the sides. Repeated paces repeat the lead/close pair.
 */
export function makeSidePlan(opts: { paces: number; total: Vec2 }): StepPlan | null {
  const paces = Math.max(1, Math.round(opts.paces));
  if (Math.abs(opts.total.x) < 0.02) return null;
  const dir = Math.sign(opts.total.x);
  const lead: StepFoot = dir < 0 ? 'R' : 'L';
  const trail = opposite(lead);
  const actionBeats = 2 * paces;
  const start = {
    left: { x: LEG.standX, z: 0 },
    right: { x: -LEG.standX, z: 0 },
  };
  const left = [initial('L')];
  const right = [initial('R')];
  const movements: string[] = [];

  for (let i = 0; i < paces; i += 1) {
    const centre = dir * PACE_SIDE * (i + 1);
    const leadContact = 2 * i + 0.6;
    const leadStart = 2 * i + 0.1;
    const leadList = lead === 'L' ? left : right;
    push(
      leadList,
      {
        x: centre + (lead === 'L' ? LEG.standX : -LEG.standX),
        z: 0,
        land: leadContact / actionBeats,
        lift: null,
        liftHeight: 0.055,
        label: 'side pace',
      },
      leadStart / actionBeats,
    );
    movements.push('side pace');

    const trailContact = 2 * i + 1.6;
    const trailStart = 2 * i + 0.8;
    const trailList = trail === 'L' ? left : right;
    push(
      trailList,
      {
        x: centre + (trail === 'L' ? LEG.standX : -LEG.standX),
        z: 0,
        land: trailContact / actionBeats,
        lift: null,
        liftHeight: 0.045,
        label: 'close',
      },
      trailStart / actionBeats,
    );
    movements.push('close');
  }

  return {
    kind: 'side',
    total: { x: opts.total.x, z: 0 },
    moveEnd: 1,
    left,
    right,
    start,
    paces,
    lead,
    counts: actionBeats,
    movements,
  };
}

/**
 * HALT from the march, in the manual's three movements (Chapter 3, 3-6):
 *
 *   ONE   the right foot is placed flat, heel as a brake, one more pace;
 *   TWO   the left foot takes a half pace, flat;
 *   THREE the right knee bends and straightens in double time, bringing the
 *         right foot alongside the left in the position of attention.
 *
 * The previous march may hand over with the trailing boot already swinging:
 * the halt's first pace is the rest of that swing. The body's net travel is
 * the left's half pace, not a full pace, and the pelvis keeps moving through
 * the whole action instead of stopping halfway and holding.
 */
export function makeHaltPlan(opts: {
  startLeft: Vec2 & Partial<FootTarget>;
  startRight: Vec2 & Partial<FootTarget>;
}): StepPlan | null {
  const actionBeats = 2;
  const start = { left: { ...opts.startLeft }, right: { ...opts.startRight } };
  const left: StepPlant[] = [{ ...start.left, land: 0, lift: null, liftHeight: 0, label: 'stand' }];
  const right: StepPlant[] = [{ ...start.right, land: 0, lift: null, liftHeight: 0, label: 'stand' }];
  // The forward foot is the one the command was given on; it takes the half
  // pace. The trailing foot takes the extra pace, then closes onto that half.
  const stepFoot: StepFoot = start.right.z < start.left.z ? 'R' : 'L';
  const closeFoot = opposite(stepFoot);
  const stepList = stepFoot === 'L' ? left : right;
  const closeList = closeFoot === 'L' ? left : right;
  const closeStart = closeFoot === 'L' ? start.left : start.right;
  const finalZ = closeStart.z + PACE_HALF;
  const stepX = stepFoot === 'L' ? LEG.standX : -LEG.standX;
  const closeX = closeFoot === 'L' ? LEG.standX : -LEG.standX;

  // ONE: the trailing boot lands where the forward boot stood, one pace on.
  push(
    stepList,
    {
      x: stepX,
      z: closeStart.z,
      land: 1 / actionBeats,
      lift: null,
      liftHeight: 0.09,
      label: 'one more pace',
    },
    0.08 / actionBeats,
  );
  // TWO: the forward boot takes a half pace. The body settles over it.
  push(
    closeList,
    {
      x: closeX,
      z: finalZ,
      land: 1.8 / actionBeats,
      lift: null,
      liftHeight: 0.045,
      label: 'half pace',
    },
    0.5 / actionBeats,
  );
  // THREE: the right knee bends and straightens in double time; the trailing
  // boot is brought alongside the left, not left a pace behind.
  push(
    stepList,
    {
      x: stepX,
      z: finalZ,
      land: 1.96 / actionBeats,
      lift: null,
      liftHeight: 0.04,
      label: 'close',
    },
    1.8 / actionBeats,
  );

  return {
    kind: 'halt',
    total: { x: 0, z: finalZ },
    moveEnd: 1,
    left,
    right,
    start,
    paces: 1,
    lead: stepFoot,
    counts: 2,
    movements: ['one more pace', 'half pace', 'close'],
    bodyAt: (raw) => ({
      x: 0,
      z: finalZ * (1 - (1 - clamp01(raw)) ** 2),
    }),
  };
}

/**
 * HALT from the slow march (Ch 3, "Marching and halting in slow time"). The
 * command is given as the RIGHT foot is forward, and the halt itself is only
 * two movements, not the quick halt's three:
 *
 *   ONE   the left foot takes a further half pace in slow time, placed flat;
 *   TWO   the right knee bends and the right foot is brought forward in quick
 *         time, beside the left, to attention.
 *
 * It is counted "one-two": one slow beat for the half pace, then a quick beat
 * to close. The right boot's forward step in quick time is what distinguishes
 * this from the quick halt, where the trailing boot takes a pace first.
 */
export function makeSlowHaltPlan(opts: {
  startLeft: FootTarget;
  startRight: FootTarget;
}): StepPlan | null {
  const start = { left: { ...opts.startLeft }, right: { ...opts.startRight } };
  if (!Number.isFinite(start.left.z) || !Number.isFinite(start.right.z)) return null;
  const finalZ = start.right.z + PACE_HALF;
  const left: StepPlant[] = [{ ...start.left, land: 0, lift: null, liftHeight: 0, label: 'stand' }];
  const right: StepPlant[] = [{ ...start.right, land: 0, lift: null, liftHeight: 0, label: 'stand' }];
  // ONE: the left closes the stride with its half pace, flat on the ground.
  push(
    left,
    {
      x: LEG.standX,
      z: finalZ,
      land: 2 / 3,
      lift: null,
      liftHeight: 0.06,
      label: 'half pace',
    },
    0.06,
  );
  // TWO: the right comes forward in quick time beside the left.
  push(
    right,
    {
      x: -LEG.standX,
      z: finalZ,
      land: 1,
      lift: null,
      liftHeight: 0.05,
      label: 'right foot forward',
    },
    2 / 3,
  );
  return {
    kind: 'halt',
    total: { x: 0, z: finalZ },
    moveEnd: 1,
    left,
    right,
    start,
    paces: 1,
    lead: 'L',
    counts: 2,
    movements: ['half pace', 'right foot forward'],
    bodyAt: (raw) => ({ x: 0, z: finalZ * smoothstep(clamp01(raw / (2 / 3))) }),
  };
}

/**
 * Distance a march covers. From the halt the first step is a half pace, so the
 * same number of paces is half a pace short of the paced distance; the step
 * plan spreads its plants over this distance rather than the nominal one.
 */
export function marchTravel(paces: number, pace: number, fromHalt: boolean): number {
  const n = Math.max(1, Math.round(paces));
  return fromHalt ? PACE_HALF + (n - 1) * pace : n * pace;
}

/**
 * A march that starts from the exact feet the previous movement left. This is
 * what carries a turn on the march into the next quick march: the turn ends
 * on a half pace, not on a gait stance, so continuing with a generic attention
 * plan would snap both boots sideways and backwards at the seam. The plants
 * are contact-fixed and the body travels across them. `endFoot` names the foot
 * the next command requires forward (the turn's command foot, or the left for
 * a halt), so the following movement starts on the correct foot.
 */
export function makeMarchPlan(opts: {
  start: { left: FootTarget; right: FootTarget };
  paces: number;
  lead: StepFoot;
  /** Forward distance the body travels, metres. */
  distance: number;
  endFoot?: StepFoot | null;
  /** Carry the trail boot into swing at the last frame (turns), not halts. */
  trailSwing?: boolean;
  /** Start from the halt: half a pace first, then the cruising pace. */
  fromHalt?: boolean;
  /**
   * Continue a march whose previous movement ended on a footfall (a turn on
   * the march or a march already in this phase). The first boot then lands a
   * full beat after the old one, not half a beat, and every plant after that
   * is one beat from the last. The body catches the half-beat offset the turn
   * left it with over the first step, so the cadence is kept without the
   * little quick-step lurch at the seam.
   */
  leadIn?: boolean;
  /** The next command is a turn, which flattens the feet at the command. */
  flatEnd?: boolean;
  /** Speed carried into the first lead-in step, metres per beat. */
  leadInSpeed?: number;
}): StepPlan | null {
  const paces = Math.max(1, Math.round(opts.paces));
  if (Math.abs(opts.distance) < 0.02) return null;
  const dir = Math.sign(opts.distance) || 1;
  const distance = Math.abs(opts.distance);
  const track = LEG.trackX;
  const toe = 6;
  if (opts.leadIn && dir > 0) {
    const contactOffset = PACE * 0.4;
    const front = Math.max(0, opts.start.left.z, opts.start.right.z);
    const lastRegular = (paces - 1) % 2 === 0 ? opts.lead : opposite(opts.lead);
    const beats = opts.endFoot && opts.endFoot !== lastRegular ? paces + 1 : paces;
    const firstBody = front + PACE - contactOffset;
    // The body is at the first plant's offset behind the leading boot. If the
    // turn ended with the shot under the body, the first beat only closes that
    // offset; after a plant-phase march the body is already a pace on.
    const bodyAtBeat = (beat: number) => {
      if (beat <= 0) return 0;
      if (beat <= 1) {
        // Start at the speed the body already had, so the seam does not read
        // as a dead stop, and finish the first step at the cruise.
        const v0 = opts.leadInSpeed ?? PACE * 0.9;
        const a = PACE + v0 - 2 * firstBody;
        const b = 3 * firstBody - PACE - 2 * v0;
        return a * beat * beat * beat + b * beat * beat + v0 * beat;
      }
      return firstBody + PACE * (beat - 1);
    };
    const startLeft = { ...opts.start.left };
    const startRight = { ...opts.start.right };
    const left: StepPlant[] = [
      { ...startLeft, land: 0, lift: null, liftHeight: 0, label: 'stand' },
    ];
    const right: StepPlant[] = [
      { ...startRight, land: 0, lift: null, liftHeight: 0, label: 'stand' },
    ];
    const movements: string[] = [];
    for (let i = 0; i < beats; i += 1) {
      const foot = i % 2 === 0 ? opts.lead : opposite(opts.lead);
      const contactBeat = i + 1;
      const list = foot === 'L' ? left : right;
      push(
        list,
        {
          x: foot === 'L' ? track : -track,
          z: dir * (front + PACE * contactBeat),
          land: contactBeat / beats,
          lift: null,
          liftHeight: 0.14,
          label: `pace ${i + 1}`,
          yaw: foot === 'L' ? toe : -toe,
        },
        Math.max(0, contactBeat - 0.84) / beats,
      );
      movements.push(`pace ${i + 1}`);
    }
    // The support boot must leave when the first boot lands, not 0.84 of a
    // beat before its own next plant: held a full pace behind it would force
    // the pelvis down to reach it.
    for (const list of [left, right]) {
      const init = list[0];
      if (init.land === 0 && init.lift !== null) init.lift = Math.min(init.lift, 1 / beats);
    }
    const plan: StepPlan = {
      kind: 'march',
      total: { x: 0, z: dir * (front + PACE * beats - contactOffset) },
      moveEnd: 1,
      left,
      right,
      start: {
        left: { x: startLeft.x, z: startLeft.z },
        right: { x: startRight.x, z: startRight.z },
      },
      paces: beats,
      beats,
      lead: opts.lead,
      counts: beats,
      movements,
    };
    plan.bodyAt = (raw) => ({ x: 0, z: dir * bodyAtBeat(clamp01(raw) * beats) });
    // The first step after a turn covers less ground than a cruising pace
    // while the body catches the offset, so a curve limited in whole beats
    // would still rise too fast per second. Slow the recovery so it reads as
    // the squad standing up through the step, not as a pop out of the turn.
    plan.hipCurve = buildMarchHipCurve(plan, beats, 0.15);
    plan.flatEnd = opts.flatEnd;
    return plan;
  }
  // The pelvis sits just behind the leading boot at each plant. Putting it
  // 0.58 of a pace behind (the old value) left the front ankle 0.435 m ahead
  // of the hip socket; with a 0.87 m leg that forced the pelvis down to
  // 0.81 m at the turn entry and 0.84 at every plant, and the squad looked
  // like it was marching in a squat. At 0.30 the leading leg stays near
  // straight and the rear boot's heel-off covers the other side.
  const contactOffset = PACE * 0.4;
  // The manual's first quick-march step from the halt is a HALF pace, not a
  // full one (Ch 3, quick march by numbers ONE), and the caller has already
  // shortened `distance` to match. The first beat spends that half pace
  // accelerating from rest to the pace the rest of the march keeps; afterwards
  // every plant lands one pace ahead of the pelvis and the body crosses the
  // last plant at cruise. Keeping the nominal distance instead
  // made the body cover the shortfall in the final half beat, at more than
  // twice the cruising speed.
  const firstStep = Math.min(PACE_HALF, distance);
  const cruisingPace = paces > 1 ? (distance - firstStep) / (paces - 1) : 0;
  const halfBodyAtBeat = (beat: number) => {
    if (beat <= 0) return 0;
    if (beat <= 1) {
      // Hermite from rest to cruise: p(0) = 0, p(1) = firstStep, p'(0) = 0,
      // p'(1) = cruisingPace. Both coefficients stay positive for every pace
      // length this app uses, so the body never backs up.
      const a = cruisingPace - 2 * firstStep;
      const b = 3 * firstStep - cruisingPace;
      return a * beat * beat * beat + b * beat * beat;
    }
    return firstStep + cruisingPace * (beat - 1);
  };
  const bodyProgressAt = (beat: number) =>
    opts.fromHalt ? halfBodyAtBeat(beat) : travel * (beat / beats);
  // Carry the exact boot pose the previous movement left. A raised heel at a
  // plant-to-plant seam must stay raised, or the pelvis drops to reach a foot
  // that was suddenly laid flat.
  const startLeft = { ...opts.start.left };
  const startRight = { ...opts.start.right };
  const left: StepPlant[] = [
    { ...startLeft, land: 0, lift: null, liftHeight: 0, label: 'stand' },
  ];
  const right: StepPlant[] = [
    { ...startRight, land: 0, lift: null, liftHeight: 0, label: 'stand' },
  ];
  const movements: string[] = [];
  const lastContact: Record<StepFoot, number> = { L: -Infinity, R: -Infinity };
  const footAt = (i: number): StepFoot => (i % 2 === 0 ? opts.lead : opposite(opts.lead));
  const lastFoot = footAt(paces - 1);
  // A command that must be given on the other foot hands over with one more
  // footfall. It lands on the next normal beat rather than half a beat after
  // the last ordered pace, so the march gains half a pace interval of time and
  // half a pace of ground; the footfall then keeps the cruising cadence.
  const extraFoot = Boolean(opts.endFoot && opts.endFoot !== lastFoot);
  const beats = paces + (extraFoot ? 0.5 : 0);
  // The extra footfall keeps the cruising cadence, so it adds half a pace
  // interval of time and the ground the body covers in that interval: half a
  // pace on a full-length stride, half the cruising pace from a short step-off.
  const travel = distance + (extraFoot ? (opts.fromHalt ? cruisingPace * 0.5 : (distance * 0.5) / paces) : 0);

  for (let i = 0; i < paces; i += 1) {
    const foot = footAt(i);
    const contactBeat = 0.5 + i;
    lastContact[foot] = contactBeat;
    const z = dir *
      (opts.fromHalt
        ? firstStep + i * cruisingPace
        : bodyProgressAt(contactBeat) + contactOffset);
    const list = foot === 'L' ? left : right;
    const swingStart = Math.max(0, contactBeat - 0.84) / beats;
    push(
      list,
      {
        x: foot === 'L' ? track : -track,
        z,
        land: contactBeat / beats,
        lift: null,
        liftHeight: 0.14,
        label: `pace ${i + 1}`,
        yaw: foot === 'L' ? toe : -toe,
      },
      swingStart,
    );
    movements.push(`pace ${i + 1}`);
  }

  if (extraFoot && opts.endFoot) {
    const foot = opts.endFoot;
    const contactBeat = paces + 0.5;
    const z = dir * (bodyProgressAt(contactBeat) + contactOffset);
    const list = foot === 'L' ? left : right;
    lastContact[foot] = contactBeat;
    push(
      list,
      {
        x: foot === 'L' ? track : -track,
        z,
        land: 1,
        lift: null,
        liftHeight: 0.09,
        label: 'next foot',
        yaw: foot === 'L' ? toe : -toe,
      },
      Math.max(0, contactBeat - 0.84) / beats,
    );
    movements.push('next foot');
  }

  // A boot whose stance ends before the movement does has to be off the
  // ground at the seam. Without a next plant it was held flat almost a full
  // pace behind the pelvis, which dragged the pelvis down with it and made
  // the following turn snap upright. Give it the next step outside the
  // movement so the ordinary swing carries it clear by the last frame.
  for (const side of (opts.trailSwing === false ? [] : ['L', 'R'] as const)) {
    const nextContact = lastContact[side] + 2;
    const swingStartBeat = nextContact - 0.84;
    if (!Number.isFinite(lastContact[side]) || swingStartBeat >= beats) continue;
    const z = dir * (bodyProgressAt(nextContact) + contactOffset);
    const list = side === 'L' ? left : right;
    push(
      list,
      {
        x: side === 'L' ? track : -track,
        z,
        // This plant is beyond the movement: it only lifts the previous boot
        // so the next movement starts from a swing, never a flat drag.
        land: nextContact / paces,
        lift: null,
        liftHeight: 0.12,
        label: 'swing through',
        yaw: side === 'L' ? toe : -toe,
      },
      Math.max(0, swingStartBeat) / beats,
    );
  }

  const plan: StepPlan = {
    kind: 'march',
    total: { x: 0, z: dir * travel },
    moveEnd: 1,
    left,
    right,
    start: {
      left: { x: startLeft.x, z: startLeft.z },
      right: { x: startRight.x, z: startRight.z },
    },
    paces,
    beats,
    lead: opts.lead,
    counts: paces,
    movements,
  };
  if (opts.fromHalt) {
    // The plants and the body already share `bodyProgressAt`; drive the
    // rendered frame from that same curve instead of repeating it here.
    plan.bodyAt = (raw) => ({ x: 0, z: dir * bodyProgressAt(clamp01(raw) * beats) });
  }
  plan.hipCurve = buildMarchHipCurve(plan, beats);
  plan.flatEnd = opts.flatEnd;
  return plan;
}

/**
 * CHANGE STEP on the march, in quick time (A-DH-201-000 Ch 3, paras 66–69).
 *
 * The command is given as the right foot is forward and on the ground:
 *
 *   ONE   a half pace with the left foot, the weight forced onto it, the right
 *         heel raised and the right arm swung forward;
 *   TWO   the arms cut to the sides and the right foot brought forward in
 *         double time, placed smartly beside the left;
 *   THREE the arms swing again as the left foot is shot forward a half pace,
 *         landing on the heel with the toe up, and the march continues.
 *
 * The plants are anchored to the boots the previous march handed over, so no
 * seam snaps a boot. The squad checks its ground speed while the boots come
 * together on the middle count, but every footfall stays one quick-time beat
 * from the last, and the movement ends on the left foot's landing.
 */
export function makeChangeStepPlan(opts: {
  startLeft: FootTarget;
  startRight: FootTarget;
}): StepPlan | null {
  const startLeft = { ...opts.startLeft };
  const startRight = { ...opts.startRight };
  if (!Number.isFinite(startLeft.z) || !Number.isFinite(startRight.z)) return null;
  const track = LEG.trackX;
  const toe = 6;
  // The shot boot lands on the heel, toe up, as the manual orders.
  const HEEL_STRIKE = -11;
  const heelY = LEG.ankle + LEG.heelLever * Math.sin((-HEEL_STRIKE * Math.PI) / 180);
  const rightPlant = startRight.z;
  const leftHalf = rightPlant + PACE_HALF;
  const leftShot = leftHalf + PACE_HALF;
  // Body keys anchored to the boots: the half pace lands just ahead of the
  // pelvis, the closed boots sit a hand's width behind it, and the shot boot
  // lands just ahead again. The squad checks through the middle beat but keeps
  // walking, so it reads as a slowed shuffle rather than a stall.
  const body1 = leftHalf - 0.05;
  const body2 = leftHalf + 0.12;
  const body3 = leftShot - 0.06;
  // The command falls on the right footfall and the counts are called in
  // double time, so the three boots land half a beat apart at +0.5, +1 and
  // +1.5 beats. The action ends on the third landing, which is where the next
  // march takes over, still in quick time.
  const bodyAtBeat = (beat: number) => {
    if (beat <= 0) return 0;
    if (beat <= 0.5) return hermite(0, PACE, body1, 0.16, beat, 0.5);
    if (beat <= 1) return hermite(body1, 0.16, body2, 0.16, beat - 0.5, 0.5);
    // The check leaves the squad walking slowly; the next march steps off
    // from this speed (CHANGE_STEP_END_SPEED) instead of snapping back to the
    // cruising pace at the seam.
    return hermite(body2, 0.16, body3, CHANGE_STEP_END_SPEED, beat - 1, 0.5);
  };
  const left: StepPlant[] = [
    { ...startLeft, land: 0, lift: null, liftHeight: 0, label: 'stand' },
  ];
  const right: StepPlant[] = [
    { ...startRight, land: 0, lift: null, liftHeight: 0, label: 'stand' },
  ];
  // ONE — the left half pace, placed flat with the weight forced onto it.
  push(
    left,
    {
      x: track,
      z: leftHalf,
      land: 1 / 3,
      lift: null,
      liftHeight: 0.1,
      label: 'half pace',
      yaw: toe,
    },
    0,
  );
  // TWO — the right closes beside the left in double time.
  push(
    right,
    {
      x: -track,
      z: leftHalf,
      land: 2 / 3,
      lift: null,
      liftHeight: 0.14,
      label: 'close beside left',
      yaw: -toe,
    },
    0.42,
  );
  // THREE — the left is shot forward and lands on the heel, toe up.
  push(
    left,
    {
      x: track,
      z: leftShot,
      land: 1,
      lift: null,
      liftHeight: 0.07,
      label: 'shot forward',
      yaw: toe,
      pitch: HEEL_STRIKE,
      y: heelY,
      contact: 'heel',
    },
    0.6,
  );
  const plan: StepPlan = {
    kind: 'changeStep',
    total: { x: 0, z: body3 },
    moveEnd: 1,
    left,
    right,
    start: {
      left: { x: startLeft.x, z: startLeft.z },
      right: { x: startRight.x, z: startRight.z },
    },
    paces: 1,
    lead: 'L',
    counts: 3,
    movements: ['half pace', 'close beside left', 'shot forward'],
  };
  plan.bodyAt = (raw) => ({ x: 0, z: bodyAtBeat(clamp01(raw) * 1.5) });
  // TWO cuts the arms to the sides; THREE picks the marching swing up again.
  plan.armsAt = (raw) => {
    if (raw <= 0.5) return 0;
    if (raw <= 0.66) return smoothstep(clamp01((raw - 0.5) / 0.16));
    if (raw <= 0.78) return 1;
    return 1 - smoothstep(clamp01((raw - 0.78) / 0.2));
  };
  return plan;
}

/**
 * Speed the squad carries out of a change step, metres per quick-time beat.
 * The boots have come together on the check, so the next march accelerates
 * from a walk instead of starting at the cruising pace.
 */
export const CHANGE_STEP_END_SPEED = 0.3;

/**
 * Cubic Hermite over an interval of `h` beats: p in metres, m in metres per
 * beat, t in beats from the start of the interval.
 */
function hermite(p0: number, m0: number, p1: number, m1: number, t: number, h: number): number {
  const a = (3 * (p1 - p0)) / (h * h) - (2 * m0 + m1) / h;
  const b = (-2 * (p1 - p0)) / (h * h * h) + (m0 + m1) / (h * h);
  return p0 + m0 * t + a * t * t + b * t * t * t;
}

/**
 * RIGHT DRESS footwork. On ONE the squad shoots the left foot forward a half
 * pace; the body travels over it. The right boot is the support: its heel
 * comes up over the planted ball as the left goes forward, so the right knee
 * is visibly bent during the check pace, exactly as the manual describes.
 * On TWO the arm goes up. On THREE the short quick paces start with the LEFT
 * foot and finish with the right. The marker stands fast.
 */
export function makeDressPlan(opts: {
  total: Vec2;
  marker: boolean;
  commander: boolean;
}): StepPlan | null {
  if (opts.marker || opts.commander) return null;
  const actionBeats = 5;
  const total = { x: opts.total.x, z: opts.total.z };
  const start = {
    left: { x: LEG.standX, z: 0 },
    right: { x: -LEG.standX, z: 0 },
  };
  const left = [initial('L')];
  const right = [initial('R')];
  const checkEnd = 2.4 / actionBeats;
  const settleStart = 2.8 / actionBeats;
  const settleEnd = 3.8 / actionBeats;
  const settleAt = (raw: number) =>
    smoothstep(clamp01((raw - settleStart) / (settleEnd - settleStart)));
  // The check pace is a weight shift onto the right boot, not a stride: the
  // left foot shoots half a pace forward while the pelvis stays over its
  // support. Carrying the pelvis forward with the left boot straightened the
  // right leg (an 11 degree knee) and left nothing for the heel raise to bend.
  // A short shift of the pelvis, held while the arm comes up and then released
  // as the short quick paces land, is what the manual's check looks like.
  const CHECK_BODY = 0.05;
  const bodyAt = (raw: number): Vec2 => {
    const settle = settleAt(raw);
    const check = smoothstep(clamp01(raw / checkEnd)) * (1 - settle);
    return { x: total.x * settle, z: CHECK_BODY * check + total.z * settle };
  };

  push(
    left,
    {
      x: LEG.standX,
      z: PACE_HALF,
      land: 1.2 / actionBeats,
      lift: null,
      liftHeight: 0.06,
      label: 'check pace',
    },
    0.1 / actionBeats,
  );

  // The right heel rises over its fixed ball as the left check pace lands.
  // A pronounced heel raise also puts a clear bend in the right knee, which
  // the manual calls for in the same movement. The ball stays fixed.
  const heel = 24;
  const heelRad = (heel * Math.PI) / 180;
  const rightCheck = {
    x: -LEG.standX,
    z: LEG.mtp * Math.cos(heelRad) - LEG.ankle * Math.sin(heelRad),
    y: LEG.ankle * Math.cos(heelRad) + LEG.mtp * Math.sin(heelRad),
    pitch: heel,
    contact: 'ball' as const,
  };
  push(
    right,
    {
      ...rightCheck,
      land: 0.16 / actionBeats,
      lift: null,
      liftHeight: 0,
      label: 'right heel',
    },
    0.06 / actionBeats,
  );

  if (Math.hypot(total.x, total.z) < 0.02) {
    // THREE starts with the left. The right closes after it, lowering the
    // heel from the ball as it comes to attention.
    push(
      left,
      {
        x: LEG.standX,
        z: 0,
        land: 4.2 / actionBeats,
        lift: null,
        liftHeight: 0.05,
        label: 'short pace',
      },
      2.8 / actionBeats,
    );
    push(
      right,
      {
        x: -LEG.standX,
        z: 0,
        land: 4.7 / actionBeats,
        lift: null,
        liftHeight: 0.04,
        label: 'close',
      },
      4.2 / actionBeats,
    );
  } else {
    // THREE starts with the left: the left short pace lands first, then the
    // right closes, both while the right heel is still carrying the check.
    push(
      left,
      {
        x: total.x + LEG.standX,
        z: total.z,
        land: 3.8 / actionBeats,
        lift: null,
        liftHeight: 0.05,
        label: 'short pace',
      },
      2.8 / actionBeats,
    );
    push(
      right,
      {
        x: total.x - LEG.standX,
        z: total.z,
        land: 4.6 / actionBeats,
        lift: null,
        liftHeight: 0.045,
        label: 'short pace',
      },
      3.8 / actionBeats,
    );
  }

  return {
    kind: 'dress',
    total,
    moveEnd: 1,
    left,
    right,
    start,
    paces: 0,
    lead: 'L',
    counts: 3,
    movements: ['check pace', 'short quick paces', 'close'],
    bodyAt,
  };
}

/**
 * FALL IN / march on. Eight 75 cm paces and a close, at 120 to the minute.
 * The body's travel is 0.75 m per beat after a half-beat step-off; each plant
 * lands half a beat after the body passes the previous plant, i.e. 37.5 cm
 * ahead of the pelvis, and the pelvis then passes over it.
 */
export function makeMarchOnPlan(opts: { total: Vec2 }): StepPlan | null {
  const { total } = opts;
  if (Math.hypot(total.x, total.z) < 0.1) return null;
  const dir = Math.sign(total.z) || 1;
  const paces = Math.max(1, Math.round(Math.abs(total.z) / PACE));
  const actionBeats = paces + 1;
  const start = {
    left: { x: LEG.standX, z: 0 },
    right: { x: -LEG.standX, z: 0 },
  };
  const left = [initial('L')];
  const right = [initial('R')];
  const lead: StepFoot = dir > 0 ? 'L' : 'R';
  const movements: string[] = [];

  for (let i = 0; i < paces; i += 1) {
    const foot = i % 2 === 0 ? lead : opposite(lead);
    const contact = 0.5 + i;
    const swingStart = contact - 0.84;
    const list = foot === 'L' ? left : right;
    const z = dir * Math.min(Math.abs(total.z), PACE * (i + 1));
    push(
      list,
      {
        x: foot === 'L' ? LEG.trackX : -LEG.trackX,
        z,
        land: contact / actionBeats,
        lift: null,
        liftHeight: 0.14,
        label: `pace ${i + 1}`,
      },
      Math.max(0, swingStart) / actionBeats,
    );
    movements.push(`pace ${i + 1}`);
  }

  const lastFoot: StepFoot = (paces - 1) % 2 === 0 ? lead : opposite(lead);
  const closeFoot = opposite(lastFoot);
  const closeList = closeFoot === 'L' ? left : right;
  // The last stride is already in the air when the body stops; the trail foot
  // closes after it, one normal swing later.
  const closeContact = paces + 0.5;
  const closeStart = closeContact - 0.84;
  push(
    closeList,
    {
      x: closeFoot === 'L' ? LEG.standX : -LEG.standX,
      z: dir * Math.abs(total.z),
      land: closeContact / actionBeats,
      lift: null,
      liftHeight: 0.05,
      label: 'close',
    },
    closeStart / actionBeats,
  );
  movements.push('close');

  return {
    kind: 'fallIn',
    total: { x: 0, z: dir * Math.abs(total.z) },
    moveEnd: paces / actionBeats,
    left,
    right,
    start,
    paces,
    lead,
    counts: paces,
    movements,
  };
}

// --------------------------------------------------------------- evaluation

function planted(foot: StepPlant, body: Vec2, side: StepFoot, heelScale = 1): FootTarget {
  // A plant with its own pitch/contact (the dress check, a raised heel) is
  // already posed by the manual; only a plain flat plant rolls up.
  const rolling = (foot.pitch ?? 0) === 0 && (foot.contact ?? 'flat') === 'flat';
  const heel = rolling ? stanceHeel(foot, body, side) * heelScale : 0;
  if (heel > 0.5) return heelPose(foot, body, side, heel);
  return {
    x: foot.x - body.x,
    y: foot.y ?? LEG.ankle,
    z: foot.z - body.z,
    pitch: foot.pitch ?? 0,
    toe: 0,
    yaw: foot.yaw ?? (side === 'L' ? 15 : -15),
    planted: true,
    contact: foot.contact ?? 'flat',
    knee: 0,
  };
}

function swinging(
  from: StepPlant,
  to: StepPlant,
  w: number,
  side: StepFoot,
  body: Vec2,
  fromPose: FootTarget,
): FootTarget {
  const e = w * w * (3 - 2 * w);
  // Start the swing from the boot the previous plant left, including the heel
  // it had rolled onto at toe-off. The old curve began at 18 degrees of
  // plantarflexion and the flat ankle height, so the first frame of the swing
  // snapped the boot down out of a raised-heel stance; the lift now begins
  // where the stance ended and eases through toe-off. The touchdown pose is
  // the next plant's own pitch and height.
  const liftPitch = fromPose.pitch + (18 - fromPose.pitch) * smoothstep(Math.min(1, w / 0.18));
  const targetPitch = to.pitch ?? 0;
  const pitch =
    w < 0.72
      ? liftPitch * (1 - smoothstep(Math.max(0, (w - 0.18) / 0.54)))
      : targetPitch * smoothstep((w - 0.72) / 0.28);
  const fromY = fromPose.y;
  const toY = to.y ?? LEG.ankle;
  // The plants are in the body frame at the start of the movement, so the
  // swing has to end in that same frame. The rig places the boot relative to
  // the current pelvis, and the pelvis has travelled: without subtracting the
  // body the swing boot would lead its own plant by the whole displacement
  // and snap backwards at touchdown.
  return {
    x: fromPose.x + (to.x - fromPose.x) * e - body.x,
    y: fromY + (toY - fromY) * e + to.liftHeight * Math.pow(Math.sin(Math.PI * w), 0.85),
    z: fromPose.z + (to.z - fromPose.z) * e - body.z,
    pitch,
    toe: Math.max(0, pitch * 0.7),
    yaw: fromPose.yaw + ((to.yaw ?? (side === 'L' ? 8 : -8)) - fromPose.yaw) * e,
    planted: false,
    contact: 'none',
    knee: 0,
  };
}

interface Evaluated {
  foot: FootTarget;
  label: string;
  planted: boolean;
  /** Where this swinging foot is about to land, if it is in swing. */
  nextPlant?: StepPlant;
}

function evaluateFoot(
  list: StepPlant[],
  side: StepFoot,
  raw: number,
  body: Vec2,
  bodyAt: (raw: number) => Vec2,
  heelScaleAt: (raw: number) => number,
): Evaluated {
  let stance = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].land <= raw + 1e-9) stance = i;
  }
  if (stance >= 0) {
    const plant = list[stance];
    if (plant.lift === null || raw < plant.lift) {
      return { foot: planted(plant, body, side, heelScaleAt(raw)), label: plant.label, planted: true };
    }
  }
  const next = list[stance + 1];
  if (!next) {
    const plant = list[list.length - 1];
    return { foot: planted(plant, body, side), label: plant.label, planted: true };
  }
  const previous = stance >= 0 ? list[stance] : list[0];
  const swingStart = previous.lift ?? 0;
  const span = Math.max(1e-6, next.land - swingStart);
  const w = Math.max(0, Math.min(1, (raw - swingStart) / span));
  // `planted` answers in body space; the swing path is in the movement's
  // start frame, so put the lift pose back where it was on the ground.
  const liftBody = bodyAt(swingStart);
  const liftLocal = planted(previous, liftBody, side, heelScaleAt(swingStart));
  const fromPose = { ...liftLocal, x: liftLocal.x + liftBody.x, z: liftLocal.z + liftBody.z };
  return {
    foot: swinging(previous, next, w, side, body, fromPose),
    label: next.label,
    planted: false,
    nextPlant: next,
  };
}

/**
 * Pelvis height that keeps both legs inside their reach. Every foot counts,
 * not only the planted ones: a swinging boot is still an IK target, and if
 * the pelvis is too high for it the solver clamps it and the boot jumps when
 * it lands. Using the current foot height means the pelvis descends exactly
 * as far as the approach to the ground requires, not just at a fixed window
 * before touchdown.
 */
export function hipHeightFor(left: FootTarget, right: FootTarget): number {
  let hip = STAND_HIP;
  for (const [foot, side] of [
    [left, 'L'] as const,
    [right, 'R'] as const,
  ]) {
    const lateral = side === 'L' ? LEG.hipX : -LEG.hipX;
    const horizontal = Math.hypot(foot.x - lateral, foot.z);
    const cap =
      foot.y + Math.sqrt(Math.max(0.0001, (REACH - 0.004) ** 2 - horizontal * horizontal));
    hip = Math.min(hip, cap);
  }
  return hip;
}

/**
 * How fast the pelvis may rise while a foot unloads. This is deliberately
 * slower than the reach cap jumps when a swing starts; the stance knee absorbs
 * the transfer for a few centimetres instead of the whole body popping up.
 * Units are metres per quick-time beat, so the motion scales with cadence.
 */
const HIP_RISE_PER_BEAT = 0.28;
const HIP_CURVE_SAMPLES = 241;
/**
 * The last part of a march eases back onto the plain reach cap. A turn starts
 * from that cap, so ending the smoothed curve below it would put a step at the
 * command. Blending over this fraction keeps the hand-off continuous while the
 * rise happens at a walking pace rather than a pop.
 */
const HIP_END_BLEND = 0.15;

/**
 * Rise-limited copy of a march's reach cap. The curve is sampled before it is
 * attached, so the samples see the true cap rather than the smoothed curve.
 */
function buildMarchHipCurve(
  plan: StepPlan,
  beats: number,
  risePerBeat = HIP_RISE_PER_BEAT,
): Float32Array {
  const n = HIP_CURVE_SAMPLES;
  const curve = new Float32Array(n);
  const capAt = (raw: number) => sampleStepPlan(plan, raw).hipY;
  let hip = capAt(0);
  curve[0] = hip;
  const dt = beats / (n - 1);
  for (let i = 1; i < n; i += 1) {
    hip = Math.min(capAt(i / (n - 1)), hip + risePerBeat * dt);
    curve[i] = hip;
  }
  // The final blend only needs the cap again over the last 15%, so the builder
  // does not keep a second 241-sample array just to read it back.
  for (let i = Math.ceil((n - 1) * (1 - HIP_END_BLEND)); i < n; i += 1) {
    const raw = i / (n - 1);
    const s = Math.max(0, (raw - (1 - HIP_END_BLEND)) / HIP_END_BLEND);
    curve[i] += (capAt(raw) - curve[i]) * smoothstep(Math.min(1, s));
  }
  return curve;
}

/**
 * Sample a plan. `raw` is the fraction of the action, and the body position is
 * derived from it with the plan's own moveEnd, so the feet and the rendered
 * body agree exactly.
 */
export function sampleStepPlan(plan: StepPlan, raw: number): StepSample {
  const t = Math.max(0, Math.min(1, raw));
  const bodyProgress = Math.min(1, t / Math.max(1e-6, plan.moveEnd));
  const bodyAt = (raw: number): Vec2 => {
    const p = Math.min(1, raw / Math.max(1e-6, plan.moveEnd));
    return plan.bodyAt
      ? plan.bodyAt(raw)
      : { x: plan.total.x * p, z: plan.total.z * p };
  };
  const body = bodyAt(t);
  // Ease the stance heel up at the first frame: the turn that hands over to
  // this march leaves the feet flat. The end is only flattened when the next
  // command is a turn, which plants flat; a march into a halt or another march
  // keeps the raised heel so the pelvis does not drop at the seam.
  const heelScaleAt = (raw: number) =>
    smoothstep(clamp01(raw / 0.035)) *
    (plan.flatEnd ? smoothstep(clamp01((1 - raw) / 0.035)) : 1);
  const left = evaluateFoot(plan.left, 'L', t, body, bodyAt, heelScaleAt);
  const right = evaluateFoot(plan.right, 'R', t, body, bodyAt, heelScaleAt);
  const reach = hipHeightFor(left.foot, right.foot);
  let hipY = reach;
  if (plan.hipCurve) {
    const pos = t * (plan.hipCurve.length - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    const next = plan.hipCurve[Math.min(plan.hipCurve.length - 1, i + 1)];
    const smoothed = plan.hipCurve[i] + (next - plan.hipCurve[i]) * f;
    // Interpolation must never lift the pelvis past either boot's reach.
    hipY = Math.min(smoothed, reach);
  }
  return {
    left: left.foot,
    right: right.foot,
    hipY,
    planted: { left: left.planted, right: right.planted },
    phase: { left: left.label, right: right.label },
    body,
  };
}

/** The present-arms right-foot stance: behind the left, toes 30° right. */
export const PRESENT_RIGHT = { x: -LEG.standX, z: -0.16, yaw: -30 } as const;

/**
 * PRESENT ARMS, count three: the right foot is raised 15 cm and placed behind
 * the left, instep against the left heel, toes 30 degrees to the right. The
 * reverse closes it beside the left on the final count of SLOPE ARMS FROM THE
 * PRESENT. The body does not travel; the left foot carries the weight.
 */
export function makePresentFootPlan(opts: {
  from: 'attention' | 'present';
  to: 'attention' | 'present';
  swingStart: number;
  land: number;
}): StepPlan | null {
  if (opts.from === opts.to) return null;
  const startRight =
    opts.from === 'present'
      ? { x: PRESENT_RIGHT.x, z: PRESENT_RIGHT.z }
      : { x: -LEG.standX, z: 0 };
  const endRight =
    opts.to === 'present'
      ? { x: PRESENT_RIGHT.x, z: PRESENT_RIGHT.z }
      : { x: -LEG.standX, z: 0 };
  const startYaw = opts.from === 'present' ? PRESENT_RIGHT.yaw : -15;
  const endYaw = opts.to === 'present' ? PRESENT_RIGHT.yaw : -15;
  const left: StepPlant[] = [
    { x: LEG.standX, z: 0, land: 0, lift: null, liftHeight: 0, label: 'stand', yaw: 15 },
  ];
  const right: StepPlant[] = [
    {
      x: startRight.x,
      z: startRight.z,
      land: 0,
      lift: null,
      liftHeight: 0,
      label: 'stand',
      yaw: startYaw,
    },
  ];
  push(
    right,
    {
      x: endRight.x,
      z: endRight.z,
      land: Math.max(opts.swingStart + 1e-4, Math.min(1, opts.land)),
      lift: null,
      liftHeight: 0.15,
      label: opts.to === 'present' ? 'right foot behind' : 'close right foot',
      yaw: endYaw,
    },
    opts.swingStart,
  );
  return {
    kind: 'present',
    total: { x: 0, z: 0 },
    moveEnd: 1,
    left,
    right,
    start: { left: { x: LEG.standX, z: 0 }, right: { x: startRight.x, z: startRight.z } },
    paces: 0,
    lead: 'R',
    counts: 1,
    movements: [opts.to === 'present' ? 'right foot behind' : 'close right foot'],
  };
}

/** How many distinct footfalls the plan orders (excluding the start). */
export function stepCount(plan: StepPlan): number {
  const ordered = (plants: StepPlant[]) => plants.filter((p) => p.land > 0 && p.land <= 1).length;
  return ordered(plan.left) + ordered(plan.right);
}
