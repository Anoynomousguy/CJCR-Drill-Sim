import { describe, expect, it } from 'vitest';
import {
  MUSCLES,
  activeMuscles,
  muscleActivationFor,
  type MuscleDef,
} from './muscles';
import type { Gait } from './types';

const find = (id: string, side: 'L' | 'R' = 'L'): MuscleDef => {
  const muscle = MUSCLES.find((m) => m.id === `${id}.${side}`);
  if (!muscle) throw new Error(`no muscle ${id}.${side}`);
  return muscle;
};

const at = (id: string, gait: Gait, phase: number, side: 'L' | 'R' = 'L') =>
  muscleActivationFor(find(id, side), gait, phase);

describe('muscle model', () => {
  it('has both sides of every muscle, mirrored across the midline', () => {
    const left = MUSCLES.filter((m) => m.side === 'L');
    const right = MUSCLES.filter((m) => m.side === 'R');
    expect(left.length).toBe(right.length);
    expect(left.length).toBeGreaterThanOrEqual(25);
    for (const muscle of left) {
      const mirror = find(muscle.id.replace('.L', ''), 'R');
      expect(mirror.origin.at[0]).toBeCloseTo(-muscle.origin.at[0], 8);
      expect(mirror.origin.at[1]).toBeCloseTo(muscle.origin.at[1], 8);
      expect(mirror.insertion.at[0]).toBeCloseTo(-muscle.insertion.at[0], 8);
      expect(mirror.name).toBe(muscle.name);
    }
  });

  it('anchors every muscle between two different bones inside the body', () => {
    for (const muscle of MUSCLES) {
      expect(muscle.origin.bone).not.toBe(muscle.insertion.bone);
      for (const anchor of [muscle.origin, muscle.insertion]) {
        const [x, y, z] = anchor.at;
        expect(Math.abs(x)).toBeLessThan(0.45);
        expect(y).toBeGreaterThan(0.03);
        expect(y).toBeLessThan(1.6);
        expect(Math.abs(z)).toBeLessThan(0.25);
      }
      expect(muscle.radius).toBeGreaterThan(0.005);
      expect(muscle.radius).toBeLessThan(0.05);
      expect(muscle.action.length).toBeGreaterThan(10);
    }
  });

  it('keeps every activation inside 0..1 and continuous around the cycle', () => {
    const gaits: Gait[] = ['halt', 'slow', 'quick', 'double', 'markTime'];
    for (const muscle of MUSCLES) {
      for (const gait of gaits) {
        let previous = muscleActivationFor(muscle, gait, 0);
        expect(previous).toBeGreaterThanOrEqual(0);
        expect(previous).toBeLessThanOrEqual(1);
        for (let i = 1; i <= 200; i += 1) {
          const value = muscleActivationFor(muscle, gait, i / 200);
          expect(value, `${muscle.id} ${gait} ${i / 200}`).toBeGreaterThanOrEqual(0);
          expect(value, `${muscle.id} ${gait} ${i / 200}`).toBeLessThanOrEqual(1);
          // No jumps: a muscle ramps, it does not switch on in one frame.
          expect(Math.abs(value - previous), `${muscle.id} ${gait} at ${i / 200}`).toBeLessThan(0.25);
          previous = value;
        }
      }
    }
  });

  it('uses the gait cycle, not a sine wave: the ankle dorsiflexor fires in swing', () => {
    // Tibialis anterior: loading response and again through swing, quiet in
    // mid-stance when the foot is flat and the soleus is carrying the body.
    expect(at('tibialisAnterior', 'quick', 0.05)).toBeGreaterThan(0.75);
    expect(at('tibialisAnterior', 'quick', 0.3)).toBeLessThan(0.3);
    expect(at('tibialisAnterior', 'quick', 0.85)).toBeGreaterThan(0.7);
  });

  it('keeps the plantarflexors on through stance and off in swing', () => {
    expect(at('soleus', 'quick', 0.3)).toBeGreaterThan(0.75);
    expect(at('soleus', 'quick', 0.8)).toBeLessThan(0.3);
    expect(at('gastrocnemius', 'quick', 0.4)).toBeGreaterThan(0.6);
    expect(at('gastrocnemius', 'quick', 0.8)).toBeLessThan(0.35);
  });

  it('loads the hip extensors and abductors at heel strike', () => {
    expect(at('gluteMax', 'quick', 0.05)).toBeGreaterThan(0.8);
    expect(at('gluteMax', 'quick', 0.35)).toBeLessThan(0.35);
    expect(at('gluteMed', 'quick', 0.1)).toBeGreaterThan(0.85);
    expect(at('gluteMed', 'quick', 0.6)).toBeLessThan(0.35);
  });

  it('fires the hamstrings in late swing to decelerate the leg', () => {
    expect(at('bicepsFemoris', 'quick', 0.95)).toBeGreaterThan(0.75);
    expect(at('bicepsFemoris', 'quick', 0.3)).toBeLessThan(0.35);
  });

  it('swings the arm half a cycle out of phase with its own leg', () => {
    const deltoid = find('deltoidAnterior');
    const atHeelStrike = muscleActivationFor(deltoid, 'quick', 0);
    const atToeOff = muscleActivationFor(deltoid, 'quick', 0.5);
    expect(atToeOff).toBeGreaterThan(atHeelStrike + 0.25);
  });

  it('gives the halted body tone rather than a dead pose', () => {
    for (const muscle of MUSCLES.slice(0, 6)) {
      const tone = muscleActivationFor(muscle, 'halt', 0.3);
      expect(tone).toBeGreaterThan(0);
      expect(tone).toBeLessThan(0.1);
    }
  });

  it('runs harder in double time than in quick time', () => {
    expect(at('vastusLateralis', 'double', 0.06)).toBeGreaterThan(
      at('vastusLateralis', 'quick', 0.06),
    );
    expect(at('bicepsFemoris', 'double', 0.94)).toBeGreaterThan(
      at('bicepsFemoris', 'quick', 0.94),
    );
  });

  it('names the prime movers for the anatomy readout', () => {
    const stance = activeMuscles('quick', 0.28, 'L', 4);
    expect(stance).toHaveLength(4);
    const names = stance.map((m) => m.def.id);
    expect(names).toContain('soleus.L');
    expect(stance[0].activation).toBeGreaterThanOrEqual(stance[3].activation);
    const swing = activeMuscles('quick', 0.85, 'L', 4);
    expect(swing.map((m) => m.def.id)).toContain('tibialisAnterior.L');
  });
});
