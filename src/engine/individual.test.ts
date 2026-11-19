import { describe, expect, it } from 'vitest';
import { hashUnit, isDirectingFlank, movementCode } from './individual';
import type { Role } from './types';

const at = (id: string, role: Role = 'cadet', rank = 0) => movementCode({ id, role, rank });
const IDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];

describe('per-cadet movement codes', () => {
  it('is deterministic and personal', () => {
    expect(at('alpha')).toEqual(at('alpha'));
    expect(at('alpha').phase).not.toBe(at('bravo').phase);
    expect(at('alpha').armSwing).not.toBe(at('bravo').armSwing);
  });

  it('keeps every signature inside a human window', () => {
    for (const id of IDS) {
      const code = at(id);
      // 12 ms of a one-second quick-time cycle: a person, not a mistake.
      expect(Math.abs(code.phase)).toBeLessThanOrEqual(0.012);
      expect(code.armSwing).toBeGreaterThan(0.9);
      expect(code.armSwing).toBeLessThan(1.1);
      expect(code.headFollow).toBeGreaterThan(0.5);
      expect(code.headFollow).toBeLessThanOrEqual(1);
    }
  });

  it('gives the right marker the directing flank', () => {
    const marker = at('marker-id', 'marker', 0);
    expect(marker.phase).toBe(0);
    expect(marker.headFollow).toBe(0);
    expect(marker.dressArm).toBe(false);
    expect(marker.leads).toBe(true);
    expect(isDirectingFlank('marker')).toBe(true);
    expect(isDirectingFlank('cadet')).toBe(false);
  });

  it('dresses the front rank only, and never the marker', () => {
    expect(at('cadet-a', 'cadet', 0).dressArm).toBe(true);
    expect(at('cadet-b', 'cadet', 1).dressArm).toBe(false);
    expect(at('cadet-c', 'cadet', 2).dressArm).toBe(false);
    expect(at('marker', 'marker', 0).dressArm).toBe(false);
    expect(at('wo', 'wo', 100).dressArm).toBe(false);
  });

  it('lets the commander look and salute, but not dress with the ranks', () => {
    const commander = at('commander', 'commander', 99);
    expect(commander.headFollow).toBeGreaterThan(0);
    expect(commander.headFollow).toBeLessThan(0.6);
    expect(commander.dressArm).toBe(false);
    expect(commander.leads).toBe(true);
  });

  it('hashes to a bounded, stable range', () => {
    for (const id of IDS) {
      for (const salt of [0, 1, 2, 7]) {
        const value = hashUnit(id, salt);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
        expect(hashUnit(id, salt)).toBe(value);
      }
    }
  });
});
