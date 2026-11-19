import {
  BEAT,
  PACE,
  PACE_DOUBLE,
  PACE_HALF,
  PACE_SIDE,
  PACE_STEP_OUT,
  PACE_STEP_SHORT,
  STANDARD_PAUSE,
} from './constants';
import { buildSoldiers, initialFrame } from './dressing';
import { gaitCycle, gaitTargets, type FootTarget } from './gait';
import { movementCode, type MovementCode } from './individual';
import { getMoveDef, INITIAL_SNAPSHOT } from './movements';
import {
  CHANGE_STEP_END_SPEED,
  makeChangeStepPlan,
  makeDressPlan,
  makeHaltPlan,
  makeMarchOnPlan,
  makeMarchPlan,
  makePacesPlan,
  makePresentFootPlan,
  makeSidePlan,
  makeSlowHaltPlan,
  marchTravel,
  sampleStepPlan,
  type StepPlan,
} from './steps';
import { makeMarchTurnPlan, marchTurnBodyAt } from './marchTurn';
import { aboutTurnBodyAt, makeAboutTurnPlan } from './aboutTurn';
import { marchSaluteAt, marchSaluteEyesAt, saluteArmAt } from './pose';
import { riflePlanFor, sampleRifle, type RiflePlan, type RifleSample } from './rifle';
import { makeTurnPlan, turnBodyAt, turnHeadingAt, type TurnBody, type TurnPlan } from './turn';
import type { Frame, Gait, Plan, Snapshot, Soldier } from './types';
import { clamp01, deg2rad, lerp, smoothstep } from './util';

export interface Warning {
  moveIndex: number;
  moveId: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
}

export interface LocalMap {
  [id: string]: { lx: number; lz: number };
}

export interface Segment {
  index: number;
  moveId: string;
  type: string;
  title: string;
  words: string;
  start: number;
  actionEnd: number;
  end: number;
  fromSnapshot: Snapshot;
  toSnapshot: Snapshot;
  fromFrame: Frame;
  toFrame: Frame;
  fromLocal: LocalMap;
  toLocal: LocalMap;
  mode: 'static' | 'linear' | 'arc' | 'turn';
  pivot?: { x: number; z: number };
  angle?: number;
  turn?: TurnPlan;
  stride0: Record<string, number>;
  scope: 'all' | 'colourParty';
  /** Explicit footwork for movements executed at the halt. */
  steps?: Record<string, StepPlan>;
  /** Fraction of the action over which the body travels (the rest is a close). */
  moveEnd?: number;
  /** Per-count Lee-Enfield carriage plan. */
  rifle?: RiflePlan;
  /** Which salute arm profile this segment runs, if any. */
  salute?: 'halt' | 'march';
  /** The commander's eyes-right salute; EYES FRONT cuts it. */
  commanderSalute?: 'raise' | 'hold' | 'cut';
  /** A head movement on the march: right or left turns the head out, front cuts it back. */
  eyesTurn?: 'right' | 'left' | 'front';
  /** This march continues the plant-to-plant phase out of a turn. */
  leadIn?: boolean;
}

export interface Timeline {
  segments: Segment[];
  duration: number;
  soldiers: Soldier[];
  warnings: Warning[];
  settings: Plan['settings'];
}

export interface SampledSoldier {
  soldier: Soldier;
  x: number;
  z: number;
  heading: number;
  stride: number;
  gait: Gait;
  /** This cadet's own beat, arm swing and position-specific rules. */
  code: MovementCode;
}

export interface Sample {
  t: number;
  moveIndex: number;
  title: string;
  words: string;
  from: Snapshot;
  to: Snapshot;
  u: number;
  /** Linear 0..1 progress; unlike `u` it is not eased. */
  progress: number;
  marchPhase: number;
  turn?: { plan: TurnPlan; progress: number };
  /** Exact halt-turn body centre and boot targets, when this is a pivot. */
  turnBody?: TurnBody;
  /** Count-sampled rifle carriage and hand grips. */
  rifle?: RifleSample;
  /** 0..1 right-arm salute: 1 through the standard pause, 0 after the cut. */
  saluteArm?: number;
  /** 0..1 head turn for a movement that turns it on a footfall. */
  eyesAmount?: number;
  /** Which way the head is turned while `eyesAmount` is above zero. */
  eyesDir?: 'left' | 'right';
  /** 0..1 commander's salute on EYES RIGHT, cut on EYES FRONT. */
  commanderSalute?: number;
  /** Per-soldier step plans for this movement, when it has explicit footwork. */
  steps?: Record<string, StepPlan>;
  /** Previous movement type, so EYES FRONT can cut a held dressing arm. */
  prevType: string;
  soldiers: SampledSoldier[];
}

const forwardOf = (heading: number) => ({ x: Math.sin(heading), z: Math.cos(heading) });
const rightOf = (heading: number) => ({ x: Math.cos(heading), z: -Math.sin(heading) });

export function worldOf(frame: Frame, lx: number, lz: number) {
  const f = forwardOf(frame.heading);
  const r = rightOf(frame.heading);
  return {
    x: frame.x + r.x * lx + f.x * lz,
    z: frame.z + r.z * lx + f.z * lz,
  };
}

function rotateAbout(p: { x: number; z: number }, pivot: { x: number; z: number }, angle: number) {
  const dx = p.x - pivot.x;
  const dz = p.z - pivot.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: pivot.x + dx * cos - dz * sin, z: pivot.z + dx * sin + dz * cos };
}

const canonical = (settings: Plan['settings'], roster: Plan['roster'], spacing: Snapshot['spacing']): LocalMap => {
  const map: LocalMap = {};
  for (const s of buildSoldiers(settings, roster, spacing)) map[s.id] = { lx: s.lx, lz: s.lz };
  return map;
};

/** The feet left by the previous movement, in the new body frame. */
function priorFeet(
  prev: Segment | undefined,
  id: string,
): { left: FootTarget; right: FootTarget } | null {
  if (!prev) return null;
  if (prev.turn?.march) {
    const body = marchTurnBodyAt(prev.turn.march, 1);
    return body ? { left: body.left, right: body.right } : null;
  }
  if (prev.turn?.about) {
    const body = aboutTurnBodyAt(prev.turn.about, 1);
    return body ? { left: body.left, right: body.right } : null;
  }
  const plan = prev.steps?.[id];
  if (plan) {
    const sample = sampleStepPlan(plan, 1);
    return { left: sample.left, right: sample.right };
  }
  return null;
}

/** Rotate feet into a body frame that changed facing (the commander at a halt). */
function rotateFeet(
  feet: { left: FootTarget; right: FootTarget },
  deg: number,
): { left: FootTarget; right: FootTarget } {
  if (Math.abs(deg) < 1e-6) return feet;
  const a = deg2rad(deg);
  const turn = (f: FootTarget): FootTarget => ({
    ...f,
    x: f.x * Math.cos(a) + f.z * Math.sin(a),
    z: -f.x * Math.sin(a) + f.z * Math.cos(a),
    yaw: f.yaw + deg,
  });
  return { left: turn(feet.left), right: turn(feet.right) };
}

/** A movement's start feet, rotated from the previous body facing into this one. */
function priorStart(
  prev: Segment | undefined,
  id: string,
  role: string,
  fromSnapshot: Snapshot,
  toSnapshot: Snapshot,
  stride: number,
  t: number,
): { left: FootTarget; right: FootTarget } {
  const feet =
    priorFeet(prev, id) ??
    gaitStartFeet(fromSnapshot, stride, t);
  const fromRole = roleHeadingOffset(role, fromSnapshot.gait);
  const toRole = roleHeadingOffset(role, toSnapshot.gait);
  return rotateFeet(feet, ((fromRole - toRole) * 180) / Math.PI);
}

/** The gait's own boots at the current phase, for a march with no step plan. */
function gaitStartFeet(
  snapshot: Snapshot,
  stride: number,
  t: number,
): { left: FootTarget; right: FootTarget } {
  const cycle = gaitCycle(snapshot.gait, stride, t);
  const g = gaitTargets(snapshot.gait, cycle);
  return { left: g.left, right: g.right };
}

/** The foot the next command requires forward. */
function commandFoot(type: string | undefined, gait: Gait): 'L' | 'R' | null {
  if (!type) return null;
  if (type === 'rightTurnOnMarch' || type === 'rightInclineOnMarch') return 'L';
  if (type === 'leftTurnOnMarch' || type === 'leftInclineOnMarch') return 'R';
  // CHANGE STEP is given as the right foot is forward and on the ground.
  if (type === 'changeStep') return 'R';
  // The about turn on the march is always given as the right foot is forward.
  if (type === 'aboutTurnOnMarch') return 'R';
  // Slow-time halt is given on the right foot; every other halt on the left.
  if (type === 'halt') return gait === 'slow' ? 'R' : 'L';
  // MARK TIME is given as the right foot is forward and on the ground.
  if (type === 'markTime') return 'R';
  // A right form is given on the left foot, a left form on the right (Ch 3,
  // change direction by forming).
  if (type === 'formRight') return 'L';
  if (type === 'formLeft') return 'R';
  // SALUTE, EYES RIGHT and EYES FRONT on the march are given as the left foot
  // is forward and on the ground (Ch 3), so the march handing over to them
  // finishes on the left foot.
  if (
    type === 'saluteOnMarch' ||
    type === 'saluteOnMarchLeft' ||
    type === 'eyesRight' ||
    type === 'eyesLeft' ||
    type === 'eyesFrontMarch'
  )
    return 'L';
  // STEP OUT/SHORT and FORWARD are given mid-march and the march continues
  // through them, so forcing its last foot at the seam would insert a
  // half-beat step instead of timing the command.
  return null;
}

function stepLength(snapshot: Snapshot): number {
  if (snapshot.step === 'out') return PACE_STEP_OUT;
  if (snapshot.step === 'short') return PACE_STEP_SHORT;
  if (snapshot.gait === 'double') return PACE_DOUBLE;
  return PACE;
}

function cadenceOf(gait: Gait, quick: number): number {
  if (gait === 'slow') return 60;
  if (gait === 'double') return 180;
  return quick;
}

function distanceTravelled(a: Frame, aLocal: LocalMap, b: Frame, bLocal: LocalMap, id: string): number {
  const p = worldOf(a, aLocal[id]?.lx ?? 0, aLocal[id]?.lz ?? 0);
  const q = worldOf(b, bLocal[id]?.lx ?? 0, bLocal[id]?.lz ?? 0);
  return Math.hypot(q.x - p.x, q.z - p.z);
}

export function buildTimeline(plan: Plan): Timeline {
  const settings = plan.settings;
  const spacing = settings.openOrder ? 'open' : 'close';
  const soldiers = buildSoldiers(settings, plan.roster, spacing);
  const warnings: Warning[] = [];

  let snapshot: Snapshot = {
    ...INITIAL_SNAPSHOT,
    spacing,
    weapon: settings.armed ? 'order' : 'none',
    colour: settings.colours > 0 ? 'order' : 'none',
  };

  let frame: Frame = initialFrame(plan);
  let local = canonical(settings, plan.roster, spacing);
  if (plan.programme[0]?.type === 'fallIn') {
    const staged: LocalMap = {};
    for (const s of soldiers) staged[s.id] = { lx: s.lx, lz: (local[s.id]?.lz ?? 0) - 6 };
    local = staged;
  }

  const stride: Record<string, number> = {};
  soldiers.forEach((s) => {
    stride[s.id] = 0;
  });

  const segments: Segment[] = [];
  // The commander's eyes-right salute is a state, not a single frame: it rises
  // on EYES RIGHT, is held through whatever is marched in between, and is cut
  // by EYES FRONT. A salute on the march cuts the arm on its own DOWN count,
  // so it ends the hold even though the eyes stay right.
  let commanderSaluteHeld = false;
  let t = 0;

  plan.programme.forEach((instance, index) => {
    const def = getMoveDef(instance.type);
    const params = { ...(def.defaults ?? {}), ...instance.params } as Record<string, number | string>;
    const eff = def.effect ?? {};

    // --- manual state rules -------------------------------------------------
    const req = def.requires;
    if (req?.weapon && !req.weapon.includes(snapshot.weapon)) {
      warnings.push({
        moveIndex: index,
        moveId: instance.id,
        severity: 'warn',
        message: `${def.title}: rifle is at ${snapshot.weapon.replace(/([A-Z])/g, ' $1').toLowerCase()}, but the movement is given from ${req.weapon.join(' / ')}.`,
      });
    }
    if (req?.colour && !req.colour.includes(snapshot.colour)) {
      warnings.push({
        moveIndex: index,
        moveId: instance.id,
        severity: 'warn',
        message: `${def.title}: the colour is at ${snapshot.colour}, but the movement is given from ${req.colour.join(' / ')}.`,
      });
    }
    if (def.discipline === 'rifle' && !settings.armed) {
      warnings.push({
        moveIndex: index,
        moveId: instance.id,
        severity: 'info',
        message: `${def.title}: no rifles are issued — enable “Armed” in the platoon settings.`,
      });
    }
    if (def.discipline === 'colour' && settings.colours === 0) {
      warnings.push({
        moveIndex: index,
        moveId: instance.id,
        severity: 'info',
        message: `${def.title}: no colour party on parade — add one in the platoon settings.`,
      });
    }
    if (req?.posture && !req.posture.includes(snapshot.posture)) {
      warnings.push({
        moveIndex: index,
        moveId: instance.id,
        severity: 'info',
        message: `${def.title}: normally given from ${req.posture.join(' / ')}.`,
      });
    }

    const fromSnapshot = snapshot;
    const fromFrame: Frame = { ...frame };
    const fromLocal: LocalMap = { ...local };
    const stride0 = { ...stride };
    let toSnapshot: Snapshot = { ...snapshot };
    let toFrame: Frame = { ...frame };
    let toLocal: LocalMap = { ...local };
    let mode: Segment['mode'] = 'static';
    let pivot: { x: number; z: number } | undefined;
    let angle: number | undefined;
    let turn: TurnPlan | undefined;
    let duration = def.counts * BEAT;
    let scope: Segment['scope'] = def.scope ?? 'all';
    let marchLeadIn = false;
    let marchDist = 0;

    const prevSeg = segments[segments.length - 1];
    const prevMarchPlan = prevSeg?.steps
      ? Object.values(prevSeg.steps).find((p) => p.kind === 'march')
      : undefined;
    // A march that closes with the half pace putting the squad on the command's
    // foot ends ON a footfall. The next movement then starts a full beat after
    // that plant, not half a beat after it: without this the first step of a
    // salute or an eyes right was a half-beat quick step at the seam.
    const prevEndsOnPlant = Boolean(
      prevMarchPlan &&
        [...prevMarchPlan.left, ...prevMarchPlan.right].some(
          (p) => Math.abs(p.land - 1) < 1e-6,
        ),
    );

    const paces = Math.max(1, Number(params.paces ?? 1));
    // EYES RIGHT and EYES FRONT on the march are two paces: the command's left
    // foot, the right foot's pace, and the left foot landing again as the head
    // turns or cuts (Ch 3, paras 89-90).
    const eyesMarch =
      instance.type === 'eyesRight' ||
      instance.type === 'eyesLeft' ||
      instance.type === 'eyesFrontMarch';
    // A salute on the march is eight paces (Ch 3), not a user parameter.
    const paceCount = def.kind === 'saluteMarch' || eyesMarch ? def.counts : paces;

    switch (def.kind) {
      case 'state':
      case 'eyes':
      case 'order': {
        if (eff.posture) toSnapshot.posture = eff.posture;
        if (eff.weapon) toSnapshot.weapon = eff.weapon;
        if (eff.stance) toSnapshot.stance = eff.stance;
        if (eff.colour) toSnapshot.colour = eff.colour;
        if (eff.eyes) toSnapshot.eyes = eff.eyes;
        if (eff.headdress) toSnapshot.headdress = eff.headdress;
        if (eff.spacing) {
          toSnapshot.spacing = eff.spacing;
          toLocal = canonical(settings, plan.roster, eff.spacing);
        }
        if (eff.step) toSnapshot.step = eff.step;
        if (eff.gait) toSnapshot.gait = eff.gait;
        // A salute at the halt is complete in itself: ONE in a beat, the
        // standard pause holding it, TWO cutting it away in a beat. The
        // regular state duration would drop the pause and the cut.
        if (instance.type === 'salute' || instance.type === 'saluteAtSlope') {
          duration = 2 * BEAT + STANDARD_PAUSE;
        }
        break;
      }
      case 'turn': {
        const deg = eff.turnDeg ?? 90;
        const context = fromSnapshot.gait === 'halt' ? 'halt' : Math.abs(deg) >= 170 ? 'aboutMarch' : 'march';
        // The command, not the sign of the angle, names the direction.
        turn = makeTurnPlan(context, deg, eff.turnDir ?? (deg < 0 ? 'right' : 'left'));
        toFrame.heading = frame.heading + turn.angle;
        if (context === 'halt' || context === 'march' || context === 'aboutMarch') {
          // Each person turns on the spot about a fixed boot contact. The
          // pivot itself shifts the body a few centimetres; the new local slot
          // is the old slot plus that offset, counter-rotated into the new
          // facing, or the whole parade would orbit the frame origin.
          let endBody: TurnBody | null = null;
          if (context === 'halt') {
            endBody = turnBodyAt(turn, 1);
          } else {
            const first = soldiers[0];
            const startFeet = priorStart(
              segments[segments.length - 1],
              first?.id ?? '',
              first?.role ?? 'cadet',
              fromSnapshot,
              toSnapshot,
              stride0[first?.id ?? ''] ?? 0,
              t,
            );
            if (context === 'march') {
              // Carry the speed of the march that is handing over into the
              // turn, so the pelvis decelerates through the half pace instead
              // of stopping on the command and lurching off again.
              const entrySpeed =
                (stepLength(fromSnapshot) * cadenceOf(fromSnapshot.gait, settings.cadence)) / 60;
              turn.march = makeMarchTurnPlan(turn, startFeet, entrySpeed) ?? undefined;
              if (turn.march) {
                endBody = marchTurnBodyAt(turn.march, 1);
                duration = 3 * BEAT;
              }
            } else {
              // About turn: five beats, two fixed ball contacts, both boots
              // coming together at attention between the pivots.
              turn.about = makeAboutTurnPlan(turn, startFeet) ?? undefined;
              if (turn.about) {
                endBody = aboutTurnBodyAt(turn.about, 1);
                duration = 5 * BEAT;
              }
            }
          }
          const cos = Math.cos(turn.angle);
          const sin = Math.sin(turn.angle);
          const rotated: LocalMap = {};
          for (const s of soldiers) {
            const l = fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
            const roleOff = roleHeadingOffset(s.role, toSnapshot.gait);
            const bx = endBody ? Math.cos(roleOff) * endBody.x + Math.sin(roleOff) * endBody.z : 0;
            const bz = endBody ? -Math.sin(roleOff) * endBody.x + Math.cos(roleOff) * endBody.z : 0;
            const ox = l.lx + bx;
            const oz = l.lz + bz;
            rotated[s.id] = { lx: ox * cos - oz * sin, lz: ox * sin + oz * cos };
          }
          toLocal = rotated;
        }
        if (!turn.march && !turn.about) {
          duration = Math.max(def.counts * BEAT, context === 'halt' ? 0.9 : 1.4);
        }
        mode = 'turn';
        break;
      }
      case 'pace': {
        const dir = String(params.dir ?? 'forward');
        // Paces forward and to the rear are half paces, never full marching
        // paces (Ch 2, paras 69-78); the three-pace cap is in the movement
        // parameters.
        const metres = dir === 'forward' || dir === 'back' ? PACE_HALF : PACE_SIDE;
        const d = paces * (dir === 'left' || dir === 'right' ? PACE_SIDE : metres);
        const f = forwardOf(frame.heading);
        const r = rightOf(frame.heading);
        if (dir === 'forward') {
          toFrame.x += f.x * d;
          toFrame.z += f.z * d;
        } else if (dir === 'back') {
          toFrame.x -= f.x * d;
          toFrame.z -= f.z * d;
        } else if (dir === 'right') {
          toFrame.x += r.x * d;
          toFrame.z += r.z * d;
        } else {
          toFrame.x -= r.x * d;
          toFrame.z -= r.z * d;
        }
        duration = paces * BEAT + BEAT;
        mode = 'linear';
        break;
      }
      case 'march': {
        toSnapshot.gait = eff.gait ?? toSnapshot.gait;
        if (eff.posture) toSnapshot.posture = eff.posture;
        if (eff.colour) toSnapshot.colour = eff.colour;
        const len = stepLength(toSnapshot);
        const cadence = cadenceOf(toSnapshot.gait, settings.cadence);
        duration = (paces * 60) / cadence;
        const f = forwardOf(frame.heading);
        // From the halt the first step is a half pace, so the march covers
        // half a pace less than the same march at speed. The step plan spreads
        // its plants over this distance; the old, nominal one made the body
        // sprint the final half beat to catch the last boot.
        const dist = marchTravel(paces, len, fromSnapshot.gait === 'halt');
        marchDist = dist;
        // A turn ends on a footfall. The next march must plant its first boot a
        // full beat later, not half a beat, or the squad takes a quick little
        // step out of every turn. Once in this phase the following marches
        // keep it: each one ends on a plant.
        marchLeadIn =
          fromSnapshot.gait !== 'halt' &&
          scope !== 'colourParty' &&
          (prevEndsOnPlant ||
            Boolean(
              prevSeg?.turn?.march ||
                prevSeg?.turn?.about ||
                prevSeg?.leadIn ||
                prevSeg?.type === 'changeStep',
            ));
        if (scope === 'colourParty') {
          for (const s of soldiers) {
            if (s.role === 'colourOfficer' || s.role === 'colourEscort') {
              const cur = toLocal[s.id] ?? { lx: s.lx, lz: s.lz };
              toLocal[s.id] = { lx: cur.lx, lz: cur.lz + dist };
            }
          }
        } else {
          toFrame.x += f.x * dist;
          toFrame.z += f.z * dist;
        }
        mode = 'linear';
        break;
      }
      case 'halt': {
        toSnapshot.gait = 'halt';
        toSnapshot.posture = 'attention';
        // Quick time: three movements, the trailing boot taking one more pace
        // and the forward boot a half pace. Slow time: two movements, the
        // left half pace and the right foot brought forward in quick time.
        // The frame advance is taken from the step plan, which owns the
        // actual foot placements.
        duration = fromSnapshot.gait === 'slow' ? 3 * BEAT : 2 * BEAT;
        if (fromSnapshot.gait !== 'halt') mode = 'linear';
        break;
      }
      case 'markTime': {
        toSnapshot.gait = 'markTime';
        duration = paces * BEAT;
        break;
      }
      case 'changeStep': {
        // A movement on the march: a half pace with the left, the right foot
        // closed beside it with the arms cut, then the left shot forward onto
        // the heel. The boots check the ground speed for the middle beat, so
        // the body covers two half paces rather than three marching paces.
        if (fromSnapshot.gait !== 'quick') {
          warnings.push({
            moveIndex: index,
            moveId: instance.id,
            severity: 'info',
            message: `${def.title}: the quick-time change step is modelled; the squad is ${fromSnapshot.gait === 'halt' ? 'halted' : `in ${fromSnapshot.gait} time`}.`,
          });
        }
        // The command falls on the right footfall and the counts are called in
        // double time, so three boots land at +0.5, +1 and +1.5 beats. The
        // action ends on the third landing; the next march plants one beat
        // after it, keeping the fast cadence right through the seam. The frame
        // travel is taken from the plan once the boots are known.
        duration = 1.5 * BEAT;
        mode = 'linear';
        break;
      }
      case 'dress': {
        toLocal = canonical(settings, plan.roster, toSnapshot.spacing);
        if (eff.eyes) toSnapshot.eyes = eff.eyes;
        if (eff.posture) toSnapshot.posture = eff.posture;
        duration = def.counts * BEAT + 2 * BEAT;
        mode = 'linear';
        break;
      }
      case 'wheel':
      case 'form': {
        const deg = eff.turnDeg ?? 90;
        const rad = deg2rad(deg);
        const frontRank = soldiers.filter((s) => s.rank === 0 || s.rank === 90);
        let flankId: string | null = null;
        let extreme = deg > 0 ? -Infinity : Infinity;
        for (const s of frontRank) {
          const lx = fromLocal[s.id]?.lx ?? s.lx;
          if (deg > 0 ? lx > extreme : lx < extreme) {
            extreme = lx;
            flankId = s.id;
          }
        }
        const flank = frontRank.find((s) => s.id === flankId) ?? frontRank[0];
        const flankLocal = flank ? fromLocal[flank.id] ?? { lx: flank.lx, lz: flank.lz } : { lx: 0, lz: 0 };
        const p = worldOf(fromFrame, flankLocal.lx, flankLocal.lz);
        pivot = p;
        angle = rad;
        const next = rotateAbout({ x: fromFrame.x, z: fromFrame.z }, p, rad);
        toFrame = { x: next.x, z: next.z, heading: fromFrame.heading + rad };
        let outer = 0;
        for (const s of soldiers) {
          const l = fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
          const w = worldOf(fromFrame, l.lx, l.lz);
          outer = Math.max(outer, Math.hypot(w.x - p.x, w.z - p.z));
        }
        const arc = Math.abs(rad) * Math.max(1, outer);
        duration = Math.max(3 * BEAT, arc / (PACE * (settings.cadence / 60)));
        toSnapshot.gait = def.kind === 'form' ? 'markTime' : 'quick';
        mode = 'arc';
        break;
      }
      case 'fall': {
        if (instance.type === 'fallIn') {
          // Members come on from the edge of the square and fall in slightly out of
          // dressing, so a following RIGHT DRESS visibly aligns the ranks.
          const homes = canonical(settings, plan.roster, snapshot.spacing);
          for (const s of soldiers) {
            // The right marker is the directing flank and the reference for the
            // following dress: he must fall in exactly on his slot, not jittered.
            if (s.role === 'marker') continue;
            const home = homes[s.id] ?? { lx: s.lx, lz: s.lz };
            const j = jitterOf(s.id);
            homes[s.id] = { lx: home.lx + j[0] * 0.16, lz: home.lz + j[1] * 0.1 };
          }
          toLocal = homes;
          toSnapshot.posture = 'attention';
          // The squad marches on in quick time; eight 75 cm paces over 6 m,
          // with the half-beat step-off and the final close. The movement ends
          // with the squad halted in its ranks, not still marching: the arms
          // are at the sides and the next command is given at the halt.
          toSnapshot.gait = 'halt';
          duration = 9 * BEAT;
        } else {
          const off: LocalMap = {};
          for (const s of soldiers) {
            const l = local[s.id] ?? { lx: s.lx, lz: s.lz };
            off[s.id] = { lx: l.lx + 14, lz: l.lz - 6 };
          }
          toLocal = off;
          toSnapshot.gait = 'quick';
          duration = def.counts * BEAT;
        }
        mode = 'linear';
        break;
      }
      case 'saluteMarch': {
        // Eight paces on the spot is not a salute: the squad marches past, the
        // arm comes up on UP and is cut on DOWN, and the head turns right on UP
        // and comes back to the front by SWING. The salute completes itself, so
        // it leaves the squad with head and eyes front, not waiting for an EYES
        // FRONT that this command never orders. The boots are planned like any
        // march so the counts land on the footfalls the manual names.
        toSnapshot.posture = 'attention';
        toSnapshot.eyes = 'front';
        const len = stepLength(toSnapshot);
        const cadence = cadenceOf(toSnapshot.gait, settings.cadence);
        duration = (def.counts * 60) / cadence;
        const f = forwardOf(frame.heading);
        const dist = marchTravel(def.counts, len, fromSnapshot.gait === 'halt');
        toFrame.x += f.x * dist;
        toFrame.z += f.z * dist;
        marchDist = dist;
        marchLeadIn =
          prevEndsOnPlant ||
          Boolean(
            prevSeg?.turn?.march ||
              prevSeg?.turn?.about ||
              prevSeg?.leadIn ||
              prevSeg?.type === 'changeStep',
          );
        if (fromSnapshot.gait !== 'quick') {
          warnings.push({
            moveIndex: index,
            moveId: instance.id,
            severity: 'info',
            message: `${def.title}: the quick-time salute on the march is modelled; the squad is ${fromSnapshot.gait === 'halt' ? 'halted' : `in ${fromSnapshot.gait} time`}.`,
          });
        }
        mode = 'linear';
        break;
      }
      default:
        break;
    }

    // --- head movements on the march ----------------------------------------
    // A freeze is not EYES RIGHT: the squad keeps marching through the command,
    // covers the two paces the manual counts, and turns the head as the left
    // foot lands again at the end of the second one.
    if (eyesMarch) {
      toSnapshot.posture = 'attention';
      const len = stepLength(toSnapshot);
      const cadence = cadenceOf(toSnapshot.gait, settings.cadence);
      duration = (def.counts * 60) / cadence;
      const f = forwardOf(frame.heading);
      const dist = marchTravel(def.counts, len, fromSnapshot.gait === 'halt');
      toFrame.x += f.x * dist;
      toFrame.z += f.z * dist;
      marchDist = dist;
      marchLeadIn =
        prevEndsOnPlant ||
        Boolean(
          prevSeg?.turn?.march ||
            prevSeg?.turn?.about ||
            prevSeg?.leadIn ||
            prevSeg?.type === 'changeStep',
        );
      if (fromSnapshot.gait !== 'quick') {
        warnings.push({
          moveIndex: index,
          moveId: instance.id,
          severity: 'info',
          message: `${def.title}: the on-the-march head movement is modelled; the squad is ${fromSnapshot.gait === 'halt' ? 'halted' : `in ${fromSnapshot.gait} time`}.`,
        });
      }
      mode = 'linear';
    }

    // --- count-sampled rifle carriages -------------------------------------
    // A rifle movement is three (or two) numbered movements separated by the
    // standard pause, not one blend. The plan supplies the count frames, the
    // hand grips and the manual's footwork.
    const rifle = def.discipline === 'rifle' ? riflePlanFor(instance.type, fromSnapshot.weapon) : null;
    if (rifle) duration = rifle.duration;
    else if (def.discipline === 'rifle') {
      // No count-sampled carriage for this movement yet, but the manual still
      // gives numbered movements separated by the standard pause. Without
      // this a five-movement port arms ran as a single two-second blend.
      duration = def.counts * BEAT + Math.max(0, def.counts - 1) * STANDARD_PAUSE;
    }

    // --- explicit footwork -------------------------------------------------
    // Movements at the halt are not a slide from A to B. Each foot is given a
    // plant, a lift and a landing; the body is free to travel across the plants
    // and the pelvis height is solved from the stance leg.
    let steps: Record<string, StepPlan> | undefined;
    let moveEnd: number | undefined;
    const needsPlan =
      def.kind === 'pace' ||
      def.kind === 'march' ||
      def.kind === 'saluteMarch' ||
      eyesMarch ||
      def.kind === 'order' ||
      def.kind === 'halt' ||
      def.kind === 'dress' ||
      def.kind === 'changeStep' ||
      (def.kind === 'fall' && instance.type === 'fallIn');
    if (needsPlan) {
      const map: Record<string, StepPlan> = {};
      const nextType = plan.programme[index + 1]?.type;
      for (const s of soldiers) {
        const a = fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
        const b = toLocal[s.id] ?? { lx: s.lx, lz: s.lz };
        const heading = fromFrame.heading + roleHeadingOffset(s.role, toSnapshot.gait);
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        // Paces and the halt move the frame; open/close, dress and fall-in
        // move each person's slot within it.
        const useFrame =
          def.kind === 'pace' ||
          def.kind === 'march' ||
          def.kind === 'saluteMarch' ||
          eyesMarch ||
          def.kind === 'halt';
        const dx = useFrame ? toFrame.x - fromFrame.x : b.lx - a.lx;
        const dz = useFrame ? toFrame.z - fromFrame.z : b.lz - a.lz;
        // formation displacement -> this soldier's body frame (x left, z forward)
        const total = { x: -(dx * cos - dz * sin), z: dx * sin + dz * cos };
        let plan: StepPlan | null = null;
        if (def.kind === 'pace') {
          // A pace from the halt has an explicit step-off. Once the squad is
          // already marching the gait carries the feet; forcing a halted step
          // plan onto a moving squad snaps both boots back to attention.
          if (fromSnapshot.gait === 'halt') {
            plan =
              Math.abs(total.x) > Math.abs(total.z)
                ? makeSidePlan({ paces, total })
                : makePacesPlan({ paces, total });
          }
        } else if (def.kind === 'order') {
          plan = makePacesPlan({
            paces: 3,
            total,
            kind: def.type === 'openOrder' ? 'open' : 'close',
            labels: ['one', 'two', 'three', 'close'],
          });
        } else if (def.kind === 'halt') {
          if (fromSnapshot.gait !== 'halt') {
            const start = priorStart(
              segments[segments.length - 1],
              s.id,
              s.role,
              fromSnapshot,
              toSnapshot,
              stride0[s.id] ?? 0,
              t,
            );
            // The plan derives its own final position from the boots at the
            // command; the formation is advanced from that total afterwards.
            plan =
              fromSnapshot.gait === 'slow'
                ? makeSlowHaltPlan({ startLeft: start.left, startRight: start.right })
                : makeHaltPlan({ startLeft: start.left, startRight: start.right });
          }
        } else if (def.kind === 'march' || def.kind === 'saluteMarch' || eyesMarch) {
          // Continue from the exact boots the last movement left, and finish on
          // the foot the next command names, so no seam snaps a planted foot.
          const start = priorStart(
            segments[segments.length - 1],
            s.id,
            s.role,
            fromSnapshot,
            toSnapshot,
            stride0[s.id] ?? 0,
            t,
          );
          const lead = start.left.z <= start.right.z ? 'L' : 'R';
          plan = makeMarchPlan({
            start,
            paces: paceCount,
            lead,
            distance: total.z,
            endFoot: commandFoot(nextType, toSnapshot.gait),
            // Into a turn or a halt the trail boot must already be swinging,
            // or the next movement starts from a crouch: a boot held flat a
            // whole pace behind the pelvis forces the hip down to 0.59 m and
            // folds the other knee to 105°. The halt's own first pace is the
            // rest of this swing.
            trailSwing: true,
            // From the halt the body accelerates through the first half
            // pace; a march handing over from a turn is already at speed,
            // while a change step hands over still checked by its half paces.
            fromHalt: fromSnapshot.gait === 'halt',
            leadIn: marchLeadIn,
            leadInSpeed:
              segments[segments.length - 1]?.type === 'changeStep'
                ? CHANGE_STEP_END_SPEED
                : undefined,
            // A turn given on the march flattens the free boot at the
            // command; lay it flat on the last frame instead of snapping it
            // down there. A halt or another march keeps the raised heel.
            flatEnd: nextType ? getMoveDef(nextType).kind === 'turn' : false,
          });
        } else if (def.kind === 'changeStep') {
          // The command is given on the right foot, so the half pace, the
          // close and the shot are anchored to the boots this march inherits.
          const start = priorStart(
            segments[segments.length - 1],
            s.id,
            s.role,
            fromSnapshot,
            toSnapshot,
            stride0[s.id] ?? 0,
            t,
          );
          plan = makeChangeStepPlan({ startLeft: start.left, startRight: start.right });
        } else if (def.kind === 'dress') {
          plan = makeDressPlan({
            total,
            marker: s.role === 'marker',
            commander: s.role === 'commander',
          });
        } else {
          plan = makeMarchOnPlan({ total });
        }
        if (plan) {
          map[s.id] = plan;
          moveEnd = plan.moveEnd;
        }
      }
      if (Object.keys(map).length) steps = map;
    }

    if (rifle?.foot && settings.armed) {
      const fromStance = fromSnapshot.stance ?? 'attention';
      const toStance = toSnapshot.stance ?? 'attention';
      const last = rifle.steps[rifle.steps.length - 1];
      const map: Record<string, StepPlan> = {};
      for (const s of soldiers) {
        if (!s.rifle) continue;
        const plan = makePresentFootPlan({
          from: fromStance,
          to: toStance,
          swingStart: last.start / rifle.duration,
          land: last.end / rifle.duration,
        });
        if (plan) map[s.id] = plan;
      }
      if (Object.keys(map).length) {
        steps = map;
        moveEnd = 1;
      }
    }

    if (def.kind === 'changeStep' && steps) {
      const plan = Object.values(steps)[0];
      if (plan) {
        // The plants are anchored to the inherited boots, which can differ by
        // a few centimetres from the nominal two half paces. Move the
        // formation by exactly what the boots did.
        const f = forwardOf(frame.heading);
        toFrame.x += f.x * plan.total.z;
        toFrame.z += f.z * plan.total.z;
        if (plan.start.right.z < plan.start.left.z - 0.02) {
          warnings.push({
            moveIndex: index,
            moveId: instance.id,
            severity: 'warn',
            message: `${def.title}: the command is given as the right foot is forward, but the squad handed over on the left foot.`,
          });
        }
      }
    }

    if ((def.kind === 'march' || def.kind === 'saluteMarch' || eyesMarch) && steps) {
      const leadPlan = Object.values(steps).find((p) => p.kind === 'march');
      if (leadPlan) {
        // A lead-in closes the offset the turn left the body with, and a
        // hand-over footfall adds half an interval of time and half a pace of
        // ground. Keep the formation on the same displacement as the boots.
        const delta = leadPlan.total.z - marchDist;
        if (Math.abs(delta) > 1e-9) {
          const f = forwardOf(frame.heading);
          toFrame.x += f.x * delta;
          toFrame.z += f.z * delta;
        }
        duration =
          leadPlan.beats! * (60 / cadenceOf(toSnapshot.gait, settings.cadence));
      }
    }

    if (def.kind === 'halt' && steps) {
      // The halt plan owns the ground the squad covers after the command:
      // the one-more pace and half pace (quick) or the half pace and quick
      // close (slow). The formation must move with the boots, not by a fixed
      // constant, or the planted feet slide through the stop.
      const haltPlan = Object.values(steps)[0];
      if (haltPlan) {
        const f = forwardOf(frame.heading);
        toFrame.x += f.x * haltPlan.total.z;
        toFrame.z += f.z * haltPlan.total.z;
      }
    }

    const actionEnd = t + duration;
    // The standard pause belongs to movements that leave the squad standing.
    // A squad still marching at the end of a command does not stop for it: the
    // stride, and therefore the arm swing, must run straight into the next
    // movement or the arms freeze for a second between marching movements.
    const end = actionEnd + (toSnapshot.gait === 'halt' ? STANDARD_PAUSE : 0);

    for (const s of soldiers) {
      let travelled = 0;
      if (mode === 'turn' && turn) {
        if (turn.context !== 'halt') {
          const l = fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
          if (turn.march) {
            travelled = turn.march.advance;
          } else if (turn.about) {
            travelled = turn.about.advance;
          } else {
            const w = worldOf(fromFrame, l.lx, l.lz);
            travelled = Math.abs(turn.angle) * Math.hypot(w.x - fromFrame.x, w.z - fromFrame.z);
          }
        }
      } else if (mode === 'arc' && pivot && angle !== undefined) {
        const l = fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
        const w = worldOf(fromFrame, l.lx, l.lz);
        travelled = Math.abs(angle) * Math.hypot(w.x - pivot.x, w.z - pivot.z);
      } else if (mode === 'linear') {
        travelled = distanceTravelled(fromFrame, fromLocal, toFrame, toLocal, s.id);
      }
      stride[s.id] = (stride[s.id] ?? 0) + travelled;
    }

    let commanderSalute: Segment['commanderSalute'];
    if (instance.type === 'eyesRight' || instance.type === 'eyesLeft') {
      const dir = instance.type === 'eyesRight' ? 'right' : 'left';
      commanderSalute = fromSnapshot.eyes !== dir ? 'raise' : 'hold';
      commanderSaluteHeld = true;
    } else if (instance.type === 'eyesFrontMarch') {
      commanderSalute = commanderSaluteHeld ? 'cut' : undefined;
      commanderSaluteHeld = false;
    } else if (instance.type === 'saluteOnMarch' || instance.type === 'saluteOnMarchLeft') {
      commanderSaluteHeld = false;
    } else if (commanderSaluteHeld) {
      commanderSalute = 'hold';
    }

    segments.push({
      index,
      moveId: instance.id,
      type: instance.type,
      title: def.title,
      words: def.words,
      start: t,
      actionEnd,
      end,
      fromSnapshot,
      toSnapshot,
      fromFrame,
      toFrame,
      fromLocal,
      toLocal,
      mode,
      pivot,
      angle,
      turn,
      stride0,
      scope,
      steps,
      moveEnd,
      rifle: rifle ?? undefined,
      salute:
        instance.type === 'salute' || instance.type === 'saluteAtSlope'
          ? 'halt'
          : instance.type === 'saluteOnMarch' || instance.type === 'saluteOnMarchLeft'
            ? 'march'
            : undefined,
      commanderSalute,
      eyesTurn:
        instance.type === 'eyesRight' || instance.type === 'saluteOnMarch'
          ? 'right'
          : instance.type === 'eyesLeft' || instance.type === 'saluteOnMarchLeft'
            ? 'left'
            : instance.type === 'eyesFrontMarch'
              ? 'front'
              : undefined,
      leadIn: marchLeadIn || undefined,
    });

    t = end;
    snapshot = toSnapshot;
    frame = toFrame;
    local = toLocal;

    // --- geometry validation ------------------------------------------------
    const positions = soldiers.map((s) => {
      const l = toLocal[s.id] ?? { lx: s.lx, lz: s.lz };
      const w = worldOf(toFrame, l.lx, l.lz);
      return { s, ...w };
    });
    const halfW = settings.squareWidth / 2;
    const halfD = settings.squareDepth / 2;
    const outside = positions.filter((p) => Math.abs(p.x) > halfW + 0.25 || Math.abs(p.z) > halfD + 0.25);
    if (outside.length) {
      warnings.push({
        moveIndex: index,
        moveId: instance.id,
        severity: instance.type === 'fallOut' || instance.type === 'dismiss' ? 'info' : 'warn',
        message: `${def.title}: ${outside.length} member${outside.length > 1 ? 's' : ''} end${outside.length > 1 ? '' : 's'} outside the parade square.`,
      });
    }
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const d = Math.hypot(positions[a].x - positions[b].x, positions[a].z - positions[b].z);
        if (d < 0.34) {
          warnings.push({
            moveIndex: index,
            moveId: instance.id,
            severity: 'warn',
            message: `${def.title}: ${positions[a].s.name} and ${positions[b].s.name} finish ${d.toFixed(2)} m apart — files are colliding.`,
          });
          break;
        }
      }
      if (warnings.filter((w) => w.moveIndex === index && w.severity === 'warn').length > 6) break;
    }
  });

  const xs = soldiers.map((s) => s.lx);
  const frontage = xs.length ? Math.max(...xs) - Math.min(...xs) + settings.intervalPaces * PACE : 0;
  if (frontage > settings.squareWidth - 2) {
    warnings.push({
      moveIndex: 0,
      moveId: '',
      severity: 'warn',
      message: `Platoon frontage is ${frontage.toFixed(1)} m — wider than the ${settings.squareWidth} m square allows for manoeuvre.`,
    });
  }

  if (!segments.length) {
    const idle: Segment = {
      index: 0,
      moveId: 'idle',
      type: 'idle',
      title: 'Platoon fallen in',
      words: 'SQUAD — STAND AT — EASE',
      start: 0,
      actionEnd: 1,
      end: 2,
      fromSnapshot: snapshot,
      toSnapshot: snapshot,
      fromFrame: frame,
      toFrame: frame,
      fromLocal: local,
      toLocal: local,
      mode: 'static',
      stride0: { ...stride },
      scope: 'all',
    };
    segments.push(idle);
  }

  return { segments, duration: segments[segments.length - 1].end, soldiers, warnings, settings };
}

export function sampleTimeline(timeline: Timeline, time: number): Sample {
  const t = Math.max(0, Math.min(time, timeline.duration));
  let seg = timeline.segments[timeline.segments.length - 1];
  for (const s of timeline.segments) {
    if (t <= s.end) {
      seg = s;
      break;
    }
  }
  const span = Math.max(0.0001, seg.actionEnd - seg.start);
  const raw = clamp01((t - seg.start) / span);
  const u = smoothstep(raw);
  // The body finishes its travel before the close of a paces/order movement.
  // Feet and frame must use the same progress or a planted foot would slide.
  const motion = clamp01(raw / (seg.moveEnd ?? 1));

  const turnProgress = seg.turn ? turnHeadingAt(seg.turn, raw) : 0;
  const bodyHeading = seg.turn
    ? seg.fromFrame.heading + seg.turn.angle * turnProgress
    : seg.fromFrame.heading;

  let frame: Frame = seg.fromFrame;
  if (seg.mode === 'turn' && seg.turn) {
    // Halt turns keep every person's feet in the same world slot and only
    // change the facing. Marching turns wheel the formation about its centre.
    frame =
      seg.turn.context === 'halt' || seg.turn.march || seg.turn.about
        ? seg.fromFrame
        : { x: seg.fromFrame.x, z: seg.fromFrame.z, heading: bodyHeading };
  } else if (seg.mode === 'arc' && seg.pivot && seg.angle !== undefined) {
    const a = seg.angle * raw;
    const p = rotateAbout({ x: seg.fromFrame.x, z: seg.fromFrame.z }, seg.pivot, a);
    frame = { x: p.x, z: p.z, heading: seg.fromFrame.heading + seg.angle * raw };
  } else if (seg.mode === 'linear') {
    // A march from the halt has a step-off: its step plan owns the body path,
    // so the frame uses the same progress as the planted feet instead of raw
    // time. Other linear movements keep their existing motion.
    const stepPlan = Object.values(seg.steps ?? {}).find(
      (p) => (p.kind === 'march' || p.kind === 'changeStep' || p.kind === 'halt') && p.bodyAt,
    );
    const stepBody = stepPlan?.bodyAt?.(raw);
    const frameProgress =
      stepPlan && stepPlan.total.z !== 0 && stepBody
        ? stepBody.z / stepPlan.total.z
        : motion;
    frame = {
      x: lerp(seg.fromFrame.x, seg.toFrame.x, frameProgress),
      z: lerp(seg.fromFrame.z, seg.toFrame.z, frameProgress),
      heading:
        seg.fromFrame.heading +
        angleDelta(seg.fromFrame.heading, seg.toFrame.heading) * frameProgress,
    };
  }

  const turnBody = seg.turn
    ? seg.turn.march
      ? marchTurnBodyAt(seg.turn.march, raw)
      : seg.turn.about
        ? aboutTurnBodyAt(seg.turn.about, raw)
        : turnBodyAt(seg.turn, raw)
    : null;
  const rifle = seg.rifle
    ? sampleRifle(seg.rifle, raw * (seg.actionEnd - seg.start), seg.fromSnapshot.posture)
    : undefined;
  const soldiers: SampledSoldier[] = timeline.soldiers.map((s) => {
    const a = seg.fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
    const b = seg.toLocal[s.id] ?? { lx: s.lx, lz: s.lz };
    const fixed =
      seg.mode === 'turn' &&
      (seg.turn?.context === 'halt' || Boolean(seg.turn?.march) || Boolean(seg.turn?.about));
    const roleOff = roleHeadingOffset(s.role, seg.toSnapshot.gait);
    // The pivot body offset is in the person's own facing; express it in the
    // formation frame before applying it to the slot.
    const bodyX = turnBody ? Math.cos(roleOff) * turnBody.x + Math.sin(roleOff) * turnBody.z : 0;
    const bodyZ = turnBody ? -Math.sin(roleOff) * turnBody.x + Math.cos(roleOff) * turnBody.z : 0;
    const stepPlan = seg.steps?.[s.id];
    const stepBody =
      stepPlan?.kind === 'dress' && stepPlan.bodyAt ? stepPlan.bodyAt(raw) : null;
    let lx: number;
    let lz: number;
    if (stepBody) {
      // The dress body path is in the soldier's own frame; express it in the
      // formation frame before adding it to the starting slot.
      const h = bodyHeading + roleHeadingOffset(s.role, seg.toSnapshot.gait);
      const cosH = Math.cos(h);
      const sinH = Math.sin(h);
      lx = a.lx - cosH * stepBody.x + sinH * stepBody.z;
      lz = a.lz + sinH * stepBody.x + cosH * stepBody.z;
    } else {
      lx = fixed ? a.lx + bodyX : lerp(a.lx, b.lx, motion);
      lz = fixed ? a.lz + bodyZ : lerp(a.lz, b.lz, motion);
    }
    const w = worldOf(frame, lx, lz);
    const isColourParty = s.role === 'colourOfficer' || s.role === 'colourEscort' || s.role === 'wo';
    const gait: Gait =
      seg.scope === 'colourParty' && !isColourParty ? seg.fromSnapshot.gait : seg.toSnapshot.gait;
    const travelled =
      seg.mode === 'turn' && seg.turn
        ? seg.turn.march || seg.turn.about
          ? Math.hypot(turnBody?.x ?? 0, turnBody?.z ?? 0)
          : seg.turn.context === 'halt'
            ? 0
            : Math.abs(seg.turn.angle * turnProgress) * Math.hypot(w.x - seg.fromFrame.x, w.z - seg.fromFrame.z)
        : seg.mode === 'arc' && seg.pivot && seg.angle !== undefined
        ? Math.abs(seg.angle * raw) * Math.hypot(w.x - seg.pivot.x, w.z - seg.pivot.z)
        : seg.mode === 'linear'
          ? distanceTravelled(seg.fromFrame, seg.fromLocal, frame, { [s.id]: { lx, lz } }, s.id)
          : 0;
    return {
      soldier: s,
      x: w.x,
      z: w.z,
      heading: bodyHeading + roleHeadingOffset(s.role, seg.toSnapshot.gait),
      stride: (seg.stride0[s.id] ?? 0) + travelled,
      gait,
      code: movementCode(s),
    };
  });

  return {
    t,
    moveIndex: seg.index,
    title: seg.title,
    words: seg.words,
    from: seg.fromSnapshot,
    to: seg.toSnapshot,
    u,
    progress: raw,
    marchPhase: 0,
    turn: seg.turn ? { plan: seg.turn, progress: raw } : undefined,
    turnBody: turnBody ?? undefined,
    rifle,
    saluteArm: seg.salute
      ? seg.salute === 'march'
        ? marchSaluteAt(raw)
        : saluteArmAt(raw)
      : undefined,
    eyesAmount:
      seg.salute === 'march'
        ? marchSaluteEyesAt(raw)
        : seg.eyesTurn === 'right' || seg.eyesTurn === 'left'
          ? smoothstep(Math.max(0, Math.min(1, (raw - 0.5) * 2)))
          : seg.eyesTurn === 'front'
            ? // EYES FRONT with no head turned (no eyes right before it) has
              // nothing to cut: starting the profile at one would swing the
              // head out to the side first.
              seg.fromSnapshot.eyes === 'front'
              ? 0
              : 1 - smoothstep(Math.max(0, Math.min(1, (raw - 0.5) * 2)))
            : undefined,
    eyesDir:
      seg.eyesTurn === 'left' || (seg.eyesTurn === 'front' && seg.fromSnapshot.eyes === 'left')
        ? 'left'
        : seg.eyesTurn
          ? 'right'
          : undefined,
    commanderSalute:
      seg.commanderSalute === 'raise'
        ? smoothstep(Math.max(0, Math.min(1, (raw - 0.5) * 2)))
        : seg.commanderSalute === 'cut'
          ? 1 - smoothstep(Math.max(0, Math.min(1, raw * 2)))
          : seg.commanderSalute === 'hold'
            ? 1
            : undefined,
    steps: seg.steps,
    prevType: seg.index > 0 ? timeline.segments[seg.index - 1].type : '',
    soldiers,
  };
}

function jitterOf(id: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 500 - 1;
  const b = ((h >>> 10) % 1000) / 500 - 1;
  return [a, b];
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function roleHeadingOffset(role: string, gait: Gait): number {
  if (role === 'commander' && gait === 'halt') return Math.PI; // faces the platoon
  return 0;
}
