import { describe, expect, it } from 'vitest';
import { JOINT_LIMITS } from './anatomy';
import {
  auditGaits,
  gaitCycle,
  gaitTargets,
  solveKnee,
  standTargets,
  turnPose,
  GAIT_SPEC,
  LEG,
} from './gait';
import type { Gait } from './types';

const WALKING: Gait[] = ['slow', 'quick', 'double', 'markTime'];
const sides = ['L', 'R'] as const;

const footOf = (gait: Gait, cycle: number, side: 'L' | 'R') =>
  gaitTargets(gait, cycle)[side === 'L' ? 'left' : 'right'];

const hipOf = (hipY: number, sway: number, side: 'L' | 'R') =>
  [side === 'L' ? LEG.hipX : -LEG.hipX, hipY, 0] as [number, number, number];

describe('contact gait', () => {
  it('keeps every planted foot on the ground and inside leg reach', () => {
    for (const gait of WALKING) {
      for (let i = 0; i < 180; i += 1) {
        const g = gaitTargets(gait, i / 180);
        for (const side of sides) {
          const foot = side === 'L' ? g.left : g.right;
          const hip = hipOf(g.hipY, g.sway, side);
          const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
          // A swing leg is allowed to reach full extension at toe-off; a foot
          // that is carrying weight must be within reach of its hip.
          if (foot.planted) expect(sol.reachable, `${gait} ${side} ${i}`).toBe(true);
          expect(foot.y, `${gait} ${side} ${i} below ground`).toBeGreaterThanOrEqual(LEG.ankle * 0.9);
          if (foot.planted) {
            expect(sol.kneeFlexion, `${gait} ${side} ${i} knee`).toBeGreaterThanOrEqual(0);
            expect(sol.kneeFlexion, `${gait} ${side} ${i} knee`).toBeLessThanOrEqual(140);
          }
        }
      }
    }
  });

  it('plants the stance foot without skating it', () => {
    for (const gait of WALKING) {
      const spec = GAIT_SPEC[gait];
      if (spec.step <= 0) continue;
      for (const side of sides) {
        const start = side === 'L' ? 0 : 0.5;
        const world: number[] = [];
        for (let i = 0; i <= 24; i += 1) {
          const cycle = start + (spec.duty * i) / 24;
          const foot = footOf(gait, cycle, side);
          if (foot.planted) world.push(cycle * 2 * spec.step + foot.z);
        }
        expect(world.length, gait).toBeGreaterThan(15);
        expect(Math.max(...world) - Math.min(...world), `${gait} ${side}`).toBeLessThan(0.001);
      }
    }
  });

  it('never bends a knee backwards', () => {
    for (const gait of WALKING) {
      for (let i = 0; i < 180; i += 1) {
        const g = gaitTargets(gait, i / 180);
        for (const side of sides) {
          const foot = side === 'L' ? g.left : g.right;
          const hip = hipOf(g.hipY, g.sway, side);
          const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
          expect(sol.kneeFlexion, `${gait} ${side} ${i}`).toBeGreaterThanOrEqual(0);
          expect(sol.knee[2], `${gait} ${side} ${i} knee behind`).toBeGreaterThanOrEqual(
            Math.min(hip[2], foot.z) - 1e-6,
          );
        }
      }
    }
  });

  it('lets the pelvis rise and fall only as far as the legs allow', () => {
    for (const gait of WALKING) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 240; i += 1) {
        const g = gaitTargets(gait, i / 240);
        lo = Math.min(lo, g.hipY);
        hi = Math.max(hi, g.hipY);
      }
      expect((hi - lo) * 100, `${gait} bob`).toBeLessThan(17);
      expect((hi - lo) * 100, `${gait} bob`).toBeGreaterThan(0.5);
    }
  });

  it('lifts the swing foot clear of the ground', () => {
    for (const gait of WALKING) {
      let clearance = 0;
      for (let i = 0; i < 240; i += 1) {
        const g = gaitTargets(gait, i / 240);
        for (const foot of [g.left, g.right]) if (!foot.planted) clearance = Math.max(clearance, foot.y);
      }
      expect(clearance * 100, `${gait} clearance`).toBeGreaterThan(8);
    }
  });

  it('runs the arm opposite the leg on the same side', () => {
    const g = gaitTargets('quick', 0);
    expect(g.left.z).toBeGreaterThan(0); // left leg forward at contact
    expect(g.armL).toBeLessThan(0); // left arm back
    expect(g.armR).toBeGreaterThan(0); // right arm forward
    expect(g.armR - g.armL).toBeGreaterThan(30);
  });

  it('is symmetric half a cycle apart', () => {
    for (const gait of WALKING) {
      const a = gaitTargets(gait, 0.27);
      const b = gaitTargets(gait, 0.77);
      expect(Math.abs(a.left.z - b.right.z), `${gait} z`).toBeLessThan(0.002);
      expect(Math.abs(a.left.y - b.right.y), `${gait} y`).toBeLessThan(0.002);
      expect(Math.abs(a.hipFlexL - b.hipFlexR), `${gait} hip`).toBeLessThan(0.5);
      expect(Math.abs(a.left.knee - b.right.knee), `${gait} knee`).toBeLessThan(0.5);
      expect(Math.abs(a.armL - b.armR), `${gait} arm`).toBeLessThan(0.5);
    }
  });

  it('holds every sampled joint inside its range of motion', () => {
    for (const gait of WALKING) {
      for (let i = 0; i < 180; i += 1) {
        const g = gaitTargets(gait, i / 180);
        for (const side of sides) {
          const foot = side === 'L' ? g.left : g.right;
          const hip = hipOf(g.hipY, g.sway, side);
          const sol = solveKnee(hip, [foot.x, foot.y, foot.z]);
          expect(sol.hipFlexion).toBeGreaterThanOrEqual(JOINT_LIMITS.hipFlexion.min);
          expect(sol.hipFlexion).toBeLessThanOrEqual(JOINT_LIMITS.hipFlexion.max);
          expect(sol.kneeFlexion).toBeLessThanOrEqual(JOINT_LIMITS.kneeFlexion.max);
          expect(foot.pitch).toBeGreaterThanOrEqual(JOINT_LIMITS.anklePlantar.min);
          expect(foot.pitch).toBeLessThanOrEqual(JOINT_LIMITS.anklePlantar.max);
          expect(foot.toe).toBeGreaterThanOrEqual(JOINT_LIMITS.toeExtension.min);
          expect(foot.toe).toBeLessThanOrEqual(JOINT_LIMITS.toeExtension.max);
        }
      }
    }
  });

  it('makes mark time a real high-knee lift and double time a run', () => {
    let hip = 0;
    let knee = 0;
    for (let i = 0; i < 180; i += 1) {
      const g = gaitTargets('markTime', i / 180);
      hip = Math.max(hip, g.hipFlexL, g.hipFlexR);
      knee = Math.max(knee, g.left.knee, g.right.knee);
    }
    expect(hip).toBeGreaterThan(45);
    expect(knee).toBeGreaterThan(70);

    let flight = 0;
    for (let i = 0; i < 180; i += 1) {
      if (gaitTargets('double', i / 180).flight) flight += 1;
    }
    expect(flight).toBeGreaterThan(0);
    // Walking keeps at least one foot down at every instant.
    for (const gait of ['slow', 'quick'] as const) {
      for (let i = 0; i < 180; i += 1) {
        const g = gaitTargets(gait, i / 180);
        expect(g.left.planted || g.right.planted, `${gait} ${i}`).toBe(true);
      }
    }
  });

  it('advances walking phase with distance, not wall time', () => {
    expect(gaitCycle('quick', 0, 0)).toBe(0);
    expect(gaitCycle('quick', 1.5, 0)).toBeCloseTo(0, 6);
    expect(gaitCycle('quick', 0.75, 0)).toBeCloseTo(0.5, 6);
    expect(gaitCycle('markTime', 0, 0.5)).toBeCloseTo(0.5, 6);
    expect(gaitCycle('halt', 3, 9)).toBe(0);
  });

  it('audits clean on the real gait model', () => {
    const audit = auditGaits(240);
    for (const report of audit.reports) {
      expect(report.contactDriftCm, `${report.gait} drift`).toBeLessThan(0.1);
      expect(report.kneeBreaches, `${report.gait} knees`).toBe(0);
      expect(report.limitBreaches, `${report.gait} limits`).toBe(0);
      expect(report.score, `${report.gait} score`).toBeGreaterThan(0.85);
    }
    expect(audit.breaches).toBe(0);
  });

  it('stands with straight legs and the feet turned out', () => {
    const stand = standTargets();
    expect(stand.hipY).toBeCloseTo(0.93, 2);
    expect(stand.left.yaw).toBe(15);
    expect(stand.right.yaw).toBe(-15);
    expect(stand.left.planted && stand.right.planted).toBe(true);
  });
});

describe('turning mechanics', () => {
  it('pivots on the inside foot with the head leading and the pelvis lagging', () => {
    const right = turnPose(120);
    expect(right.inside).toBe('R');
    expect(right.magnitude).toBeCloseTo(0.86, 2);
    expect(right.headYaw).toBeGreaterThan(right.chestYaw);
    expect(right.chestYaw).toBeGreaterThan(0);
    expect(right.pelvisYaw).toBeLessThan(0);
    expect(right.list).toBeGreaterThan(0);
    expect(right.shift).toBeLessThan(0);
    expect(right.insideHeel).toBeGreaterThan(0);
  });

  it('mirrors left and right turns', () => {
    const left = turnPose(-120);
    expect(left.inside).toBe('L');
    expect(left.headYaw).toBeLessThan(0);
    expect(left.pelvisYaw).toBeGreaterThan(0);
    expect(left.shift).toBeGreaterThan(0);
  });

  it('settles to nothing when the body is not turning', () => {
    const still = turnPose(0);
    expect(still.magnitude).toBe(0);
    expect(still.lean).toBe(0);
    expect(still.pelvisYaw).toBeCloseTo(0, 6);
  });
});
