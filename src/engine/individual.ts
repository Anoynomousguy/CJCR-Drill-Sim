// Per-cadet movement codes.
//
// A formed body looks like one machine only because every person is doing the
// same movement on their own beat. The manual fixes the shape and the timing —
// 120 paces per minute, a 75 cm pace, two beats of standard pause — but it does
// not make thirty-one bodies identical. This module gives each soldier a small,
// deterministic signature (a few milliseconds of phase, a little more or less
// arm swing) and the position-specific rules the manual does state:
//
//   - on an eyes-right the right marker is the directing flank and keeps head
//     and eyes to the front;
//   - the platoon commander is not in the ranks and does not dress with them,
//     and on an eyes-right the person in command salutes;
//   - right dress takes its stand-fast person and raised arms from the current
//     front rank, not from the rank a soldier held at fall-in.
//
// The values are tiny on purpose. A body that is 30 ms out of step reads as a
// person; one that is 300 ms out reads as a mistake.

import type { Role, Soldier } from './types';

export interface MovementCode {
  /** Cycle offset, fraction of a step; positive is later. 0.012 = 12 ms. */
  phase: number;
  /** Arm-swing multiplier, so no two people drive the arms identically. */
  armSwing: number;
  /** How much of an eyes order the head takes. 0 = head stays front. */
  headFollow: number;
  /** Marker and commander own the timing; everyone else follows it. */
  leads: boolean;
}

/** Deterministic hash in [-1, 1]; the same soldier always moves the same way. */
export function hashUnit(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2001) / 1000 - 1;
}

export function movementCode(soldier: Pick<Soldier, 'id' | 'role' | 'rank'>): MovementCode {
  const a = hashUnit(soldier.id, 1);
  const b = hashUnit(soldier.id, 2);
  const marker = soldier.role === 'marker';
  const commander = soldier.role === 'commander';
  return {
    // The marker sets the beat, so the marker has no offset.
    phase: marker ? 0 : a * 0.012,
    armSwing: marker ? 1 : 1 + b * 0.05,
    headFollow: marker ? 0 : commander ? 0.45 : 0.88 + Math.abs(a) * 0.12,
    leads: marker || commander,
  };
}

/** True when this soldier is the directing flank (head stays front on eyes right). */
export function isDirectingFlank(role: Role): boolean {
  return role === 'marker';
}
