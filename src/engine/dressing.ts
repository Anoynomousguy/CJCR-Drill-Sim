import { PACE, PACE_HALF } from './constants';
import type { Plan, PlanSettings, RosterEntry, Soldier, Spacing, Role } from './types';

const ROLE_PRIORITY: Role[] = ['cadet'];

/**
 * Sizing and dressing follow the Manual of Drill and Ceremonial:
 *  - Ch 2, §Sizing: tallest on the right, shortest on the left, three ranks,
 *    shoulder-to-shoulder dressing and covering off front to rear.
 *  - Ch 2, §Formation of a squad: arm's length interval between files.
 *  - Ch 2, §Open order march: front rank three half paces forward, rear rank
 *    three half paces back, centre rank stands fast (two ranks: rear steps back).
 *  - Ch 7, §Platoon in line: squads side by side with a seven-pace interval,
 *    commander three paces in front, supernumerary rank three paces behind.
 *  - Ch 8, §Composition of a colour party.
 */
export function buildSoldiers(settings: PlanSettings, roster: RosterEntry[], spacing: Spacing): Soldier[] {
  const ranks = settings.ranks;
  const interval = settings.intervalPaces * PACE;
  const gap = settings.squadGapPaces * PACE;
  const squadCount = Math.max(1, Math.round(settings.squads));

  // Manual sizing: order by height, tallest first. Squads are filled with
  // contiguous batches so the tallest soldiers end up on the right flank.
  const sized = [...roster].sort((a, b) => b.height - a.height);
  const squads: RosterEntry[][] = Array.from({ length: squadCount }, () => []);
  sized.forEach((entry, i) => {
    const squad = Math.min(squadCount - 1, Math.floor((i * squadCount) / Math.max(1, sized.length)));
    squads[squad].push(entry);
  });

  const filesPerSquad = squads.map((s) => Math.max(1, Math.ceil(s.length / ranks)));
  const frontages = filesPerSquad.map((files) => files * interval);
  const totalFrontage =
    frontages.reduce((sum, f) => sum + f, 0) + gap * Math.max(0, squadCount - 1);

  const rightEdges: number[] = [];
  let cursor = totalFrontage / 2;
  for (let s = 0; s < squadCount; s += 1) {
    rightEdges.push(cursor);
    cursor -= frontages[s];
    if (s < squadCount - 1) cursor -= gap;
  }

  const out: Soldier[] = [];
  let index = 0;
  squads.forEach((members, squad) => {
    const rightEdge = rightEdges[squad];
    members.forEach((entry, i) => {
      const file = Math.floor(i / ranks);
      const rank = i % ranks;
      const lx = rightEdge - (file + 0.5) * interval;
      const lz = rankOffset(rank, ranks, spacing, settings.rankSpacingPaces);
      const role: Role = squad === 0 && file === 0 && rank === 0 ? 'marker' : ROLE_PRIORITY[0];
      out.push({
        id: entry.id,
        index,
        name: soldierName(index, role),
        height: entry.height,
        squad,
        rank,
        file,
        role,
        rifle: settings.armed && role !== 'commander',
        colour: false,
        lx,
        lz,
      });
      index += 1;
    });
  });

  const rearZ = Math.min(...out.map((s) => s.lz), 0);

  if (settings.commander) {
    out.push({
      id: 'commander',
      index,
      name: 'Platoon commander',
      height: 1.8,
      squad: -1,
      rank: 99,
      file: 99,
      role: 'commander',
      rifle: false,
      colour: false,
      lx: 0,
      lz: 3 * PACE,
    });
    index += 1;
  }

  if (settings.supernumerary) {
    for (let i = 0; i < 3; i += 1) {
      const lx = -totalFrontage / 2 + totalFrontage * ((i + 1) / 4);
      out.push({
        id: `wo-${i}`,
        index,
        name: i === 1 ? 'Platoon warrant officer' : `Warrant officer ${i + 1}`,
        height: 1.82,
        squad: -1,
        rank: 100,
        file: 100,
        role: 'wo',
        rifle: true,
        colour: false,
        lx,
        lz: rearZ - 3 * PACE,
      });
      index += 1;
    }
  }

  if (settings.colours > 0) {
    const partyZ = 6 * PACE;
    if (settings.colours === 1) {
      out.push(colourSoldier('colour-officer', 'Colour officer', 0, partyZ, 1.8, 'colourOfficer'));
      out.push(colourSoldier('colour-escort-l', 'Colour escort (left)', -1.1, partyZ, 1.77, 'colourEscort'));
      out.push(colourSoldier('colour-escort-r', 'Colour escort (right)', 1.1, partyZ, 1.77, 'colourEscort'));
    } else {
      out.push(colourSoldier('colour-officer-r', 'Colour officer (Queen’s Colour)', 1.3, partyZ, 1.82, 'colourOfficer'));
      out.push(colourSoldier('colour-officer-l', 'Colour officer (Regimental Colour)', -1.3, partyZ, 1.79, 'colourOfficer'));
      out.push(colourSoldier('colour-wo', 'Colour warrant officer', 0, partyZ, 1.84, 'wo'));
      out.push(colourSoldier('colour-escort-l', 'Colour escort (left)', -3.2, partyZ, 1.76, 'colourEscort'));
      out.push(colourSoldier('colour-escort-r', 'Colour escort (right)', 3.2, partyZ, 1.76, 'colourEscort'));
    }
    out.sort((a, b) => a.index - b.index);
  }

  return out;
}

function colourSoldier(
  id: string,
  name: string,
  lx: number,
  lz: number,
  height: number,
  role: Role,
): Soldier {
  return {
    id,
    index: 0,
    name,
    height,
    squad: -1,
    rank: 98,
    file: 98,
    role,
    rifle: role === 'colourEscort' || role === 'wo',
    colour: role === 'colourOfficer',
    lx,
    lz,
  };
}

function rankOffset(rank: number, ranks: number, spacing: Spacing, rankSpacingPaces: number): number {
  const step = rankSpacingPaces * PACE;
  if (spacing === 'close') return -rank * step;
  if (ranks === 2) return rank === 0 ? 0 : -(step + 3 * PACE_HALF);
  if (rank === 0) return 3 * PACE_HALF;
  if (rank === ranks - 1) return -(rank - 1) * step - 3 * PACE_HALF;
  return -rank * step;
}

export function soldierName(index: number, role: Role): string {
  if (role === 'marker') return `Cadet ${String(index + 1).padStart(2, '0')} · marker`;
  return `Cadet ${String(index + 1).padStart(2, '0')}`;
}

/** Total platoon frontage in metres, used for square-fit validation. */
export function frontageOf(settings: PlanSettings, roster: RosterEntry[]): number {
  const soldiers = buildSoldiers(settings, roster, 'close').filter((s) => s.rank < 90);
  if (!soldiers.length) return 0;
  const xs = soldiers.map((s) => s.lx);
  return Math.max(...xs) - Math.min(...xs) + settings.intervalPaces * PACE;
}

/**
 * Frame origin: centre of the front rank. The rear-most person (supernumerary rank
 * or colour party) is placed `startPacesFromEdge` paces in front of the rear edge,
 * so the whole body fits on the square when it falls in.
 */
export function initialFrame(plan: Plan): { x: number; z: number; heading: number } {
  const { settings } = plan;
  const spacing = settings.openOrder ? 'open' : 'close';
  const soldiers = buildSoldiers(settings, plan.roster, spacing);
  const minLz = Math.min(0, ...soldiers.map((s) => s.lz));
  return {
    x: 0,
    z: -settings.squareDepth / 2 + Math.max(0.5, settings.startPacesFromEdge) * PACE - minLz,
    heading: (settings.headingDeg * Math.PI) / 180,
  };
}
