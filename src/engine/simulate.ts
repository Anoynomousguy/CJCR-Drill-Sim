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
import { getMoveDef, INITIAL_SNAPSHOT } from './movements';
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
  mode: 'static' | 'linear' | 'arc';
  pivot?: { x: number; z: number };
  angle?: number;
  stride0: Record<string, number>;
  scope: 'all' | 'colourParty';
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
}

export interface Sample {
  t: number;
  moveIndex: number;
  title: string;
  words: string;
  from: Snapshot;
  to: Snapshot;
  u: number;
  marchPhase: number;
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
    let duration = def.counts * BEAT;
    let scope: Segment['scope'] = def.scope ?? 'all';

    const paces = Math.max(1, Number(params.paces ?? 1));

    switch (def.kind) {
      case 'state':
      case 'eyes':
      case 'order': {
        if (eff.posture) toSnapshot.posture = eff.posture;
        if (eff.weapon) toSnapshot.weapon = eff.weapon;
        if (eff.colour) toSnapshot.colour = eff.colour;
        if (eff.eyes) toSnapshot.eyes = eff.eyes;
        if (eff.headdress) toSnapshot.headdress = eff.headdress;
        if (eff.spacing) {
          toSnapshot.spacing = eff.spacing;
          toLocal = canonical(settings, plan.roster, eff.spacing);
        }
        if (eff.step) toSnapshot.step = eff.step;
        if (eff.gait) toSnapshot.gait = eff.gait;
        break;
      }
      case 'turn': {
        const deg = eff.turnDeg ?? 90;
        toFrame.heading = frame.heading + deg2rad(deg);
        duration = Math.max(def.counts * BEAT, 0.9);
        break;
      }
      case 'pace': {
        const dir = String(params.dir ?? 'forward');
        const metres = paces <= 3 && (dir === 'forward' || dir === 'back') ? PACE_HALF : PACE;
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
        const dist = paces * len;
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
        duration = 2 * BEAT;
        break;
      }
      case 'markTime': {
        toSnapshot.gait = 'markTime';
        duration = paces * BEAT;
        break;
      }
      case 'changeStep': {
        duration = 3 * BEAT;
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
            const home = homes[s.id] ?? { lx: s.lx, lz: s.lz };
            const j = jitterOf(s.id);
            homes[s.id] = { lx: home.lx + j[0] * 0.16, lz: home.lz + j[1] * 0.1 };
          }
          toLocal = homes;
          toSnapshot.posture = 'attention';
          duration = def.counts * BEAT;
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
        toSnapshot.posture = 'salute';
        toSnapshot.eyes = 'right';
        duration = def.counts * BEAT;
        break;
      }
      default:
        break;
    }

    const actionEnd = t + duration;
    const end = actionEnd + STANDARD_PAUSE;

    for (const s of soldiers) {
      let travelled = 0;
      if (mode === 'arc' && pivot && angle !== undefined) {
        const l = fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
        const w = worldOf(fromFrame, l.lx, l.lz);
        travelled = Math.abs(angle) * Math.hypot(w.x - pivot.x, w.z - pivot.z);
      } else if (mode === 'linear') {
        travelled = distanceTravelled(fromFrame, fromLocal, toFrame, toLocal, s.id);
      }
      stride[s.id] = (stride[s.id] ?? 0) + travelled;
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
      stride0,
      scope,
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

  let frame: Frame = seg.fromFrame;
  if (seg.mode === 'arc' && seg.pivot && seg.angle !== undefined) {
    const a = seg.angle * raw;
    const p = rotateAbout({ x: seg.fromFrame.x, z: seg.fromFrame.z }, seg.pivot, a);
    frame = { x: p.x, z: p.z, heading: seg.fromFrame.heading + seg.angle * raw };
  } else if (seg.mode === 'linear') {
    frame = {
      x: lerp(seg.fromFrame.x, seg.toFrame.x, raw),
      z: lerp(seg.fromFrame.z, seg.toFrame.z, raw),
      heading: seg.fromFrame.heading + angleDelta(seg.fromFrame.heading, seg.toFrame.heading) * raw,
    };
  }

  const soldiers: SampledSoldier[] = timeline.soldiers.map((s) => {
    const a = seg.fromLocal[s.id] ?? { lx: s.lx, lz: s.lz };
    const b = seg.toLocal[s.id] ?? { lx: s.lx, lz: s.lz };
    const lx = lerp(a.lx, b.lx, raw);
    const lz = lerp(a.lz, b.lz, raw);
    const w = worldOf(frame, lx, lz);
    const isColourParty = s.role === 'colourOfficer' || s.role === 'colourEscort' || s.role === 'wo';
    const gait: Gait =
      seg.scope === 'colourParty' && !isColourParty ? seg.fromSnapshot.gait : seg.toSnapshot.gait;
    const travelled =
      seg.mode === 'arc' && seg.pivot && seg.angle !== undefined
        ? Math.abs(seg.angle * raw) * Math.hypot(w.x - seg.pivot.x, w.z - seg.pivot.z)
        : seg.mode === 'linear'
          ? distanceTravelled(seg.fromFrame, seg.fromLocal, frame, { [s.id]: { lx, lz } }, s.id)
          : 0;
    return {
      soldier: s,
      x: w.x,
      z: w.z,
      heading: frame.heading + roleHeadingOffset(s.role, seg.toSnapshot.gait),
      stride: (seg.stride0[s.id] ?? 0) + travelled,
      gait,
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
    marchPhase: 0,
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
