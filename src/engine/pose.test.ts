import { describe, expect, it } from 'vitest';
import { GAIT_ANATOMY, JOINT_LIMITS, clampJoint, type JointName } from './anatomy';
import {
  ARM_MAX_REACH,
  ARM_MIN_REACH,
  BODY,
  COLOUR_CARRIAGE,
  GROUND_Y,
  POSTURE_HANDS,
  RIFLE,
  RIFLE_CARRIAGE,
  auditGaits,
  carriageDir,
  carriagePoint,
  distance,
  distanceForElbow,
  gaitPose,
  handIsGripping,
  poseTargets,
  swingHand,
  type Vec3,
} from './pose';
import type { Gait, Snapshot, WeaponState } from './types';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  posture: 'attention',
  weapon: 'order',
  colour: 'none',
  gait: 'halt',
  eyes: 'front',
  headdress: 'worn',
  spacing: 'close',
  ...over,
});

const shoulder = (side: 'L' | 'R'): Vec3 => [
  side === 'L' ? BODY.shoulderX : -BODY.shoulderX,
  BODY.shoulderY,
  0,
];

const legPairs = (p: ReturnType<typeof gaitPose>): [JointName, number][] => [
  ['hipFlexion', p.hipL],
  ['hipFlexion', p.hipR],
  ['kneeFlexion', p.kneeL],
  ['kneeFlexion', p.kneeR],
  ['anklePlantar', p.ankleL],
  ['anklePlantar', p.ankleR],
];

describe('gait anatomy', () => {
  const manual: Gait[] = ['quick', 'slow', 'double', 'markTime'];

  it('puts the leading leg exactly on the manual target at the top of the swing', () => {
    for (const gait of manual) {
      const target = GAIT_ANATOMY[gait];
      const p = gaitPose(gait, Math.PI / 2);
      expect(p.hipL, `${gait} hip`).toBeCloseTo(target.hip, 6);
      expect(p.kneeL, `${gait} knee`).toBeCloseTo(target.knee, 6);
      expect(p.ankleL, `${gait} ankle`).toBeCloseTo(target.ankle, 6);
      expect(p.hipR, `${gait} rear hip`).toBeCloseTo(-target.hipBack, 6);
      expect(p.kneeR, `${gait} rear knee`).toBeCloseTo(target.kneeBack, 6);
    }
  });

  it('never leaves the anatomical range at any phase of any gait', () => {
    for (const gait of Object.keys(GAIT_ANATOMY) as Gait[]) {
      for (let i = 0; i < 720; i += 1) {
        const p = gaitPose(gait, (i / 720) * Math.PI * 2);
        for (const [joint, value] of legPairs(p)) {
          const limit = JOINT_LIMITS[joint];
          expect(value, `${gait} ${joint}`).toBeGreaterThanOrEqual(limit.min - 1e-9);
          expect(value, `${gait} ${joint}`).toBeLessThanOrEqual(limit.max + 1e-9);
        }
      }
    }
  });

  it('clamps a joint asked for more than its range', () => {
    for (const [name, limit] of Object.entries(JOINT_LIMITS)) {
      expect(clampJoint(name as JointName, limit.min - 100)).toBe(limit.min);
      expect(clampJoint(name as JointName, limit.max + 100)).toBe(limit.max);
    }
  });

  it('passes its own audit', () => {
    const audit = auditGaits();
    expect(audit.gaits.length).toBe(Object.keys(GAIT_ANATOMY).length);
    expect(audit.onTarget).toBe(audit.gaits.length);
    expect(audit.limitBreaches).toBe(0);
    for (const gait of audit.gaits) {
      expect(gait.onTarget, gait.gait).toBe(true);
      expect(gait.withinLimits, gait.gait).toBe(true);
    }
  });
});

describe('rifle carriage', () => {
  it('stands the rifle on the square at the order', () => {
    const c = RIFLE_CARRIAGE.order;
    expect(c.butt[1]).toBeCloseTo(GROUND_Y, 6);
    expect(carriageDir(c)[1]).toBeCloseTo(1, 6);
    const t = poseTargets(snap({ weapon: 'order' }), true, false);
    expect(t.handR).toEqual(carriagePoint(c, RIFLE.grip.order));
    expect(distance(t.handR, shoulder('R'))).toBeLessThanOrEqual(ARM_MAX_REACH + 1e-9);
    expect(t.handL).toEqual(POSTURE_HANDS.attention.left);
    expect(handIsGripping(t, 'R')).toBe(true);
    expect(handIsGripping(t, 'L')).toBe(false);
  });

  it('rests the rifle in the hollow of the left shoulder at the slope', () => {
    const c = RIFLE_CARRIAGE.slope;
    const d = carriageDir(c);
    const to: Vec3 = [shoulder('L')[0] - c.butt[0], BODY.shoulderY - c.butt[1], -c.butt[2]];
    const along = to[0] * d[0] + to[1] * d[1] + to[2] * d[2];
    expect(along).toBeGreaterThan(0.3);
    expect(distance(carriagePoint(c, along), shoulder('L'))).toBeLessThan(0.06);

    const muzzle = carriagePoint(c, RIFLE.length);
    expect(muzzle[1]).toBeGreaterThan(BODY.shoulderY + 0.4);
    expect(muzzle[2]).toBeLessThan(-0.1);

    const t = poseTargets(snap({ weapon: 'slope' }), true, false);
    expect(t.handL).toEqual(carriagePoint(c, RIFLE.grip.small));
    expect(t.handR).toEqual(POSTURE_HANDS.attention.right);
    expect(handIsGripping(t, 'L')).toBe(true);
    expect(handIsGripping(t, 'R')).toBe(false);
  });

  it('puts both hands on the rifle at the present and the port', () => {
    for (const state of ['present', 'port'] as const) {
      const c = RIFLE_CARRIAGE[state];
      const t = poseTargets(snap({ weapon: state }), true, false);
      expect(t.handL, state).toEqual(carriagePoint(c, c.hands.left ?? 0));
      expect(t.handR, state).toEqual(carriagePoint(c, c.hands.right ?? 0));
      expect(handIsGripping(t, 'L'), state).toBe(true);
      expect(handIsGripping(t, 'R'), state).toBe(true);
      // Left hand at the balance, above the right hand at the small of the butt.
      expect(t.handL[1], state).toBeGreaterThan(t.handR[1]);
      for (const side of ['L', 'R'] as const) {
        const d = distance(side === 'L' ? t.handL : t.handR, shoulder(side));
        expect(d, `${state} ${side}`).toBeGreaterThanOrEqual(ARM_MIN_REACH - 1e-9);
        expect(d, `${state} ${side}`).toBeLessThanOrEqual(ARM_MAX_REACH + 1e-9);
      }
    }
    expect(carriageDir(RIFLE_CARRIAGE.present)[1]).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
    const portMuzzle = carriagePoint(RIFLE_CARRIAGE.port, RIFLE.length);
    expect(portMuzzle[0]).toBeGreaterThan(BODY.shoulderX);
    expect(portMuzzle[1]).toBeGreaterThan(BODY.shoulderY);
  });

  it('keeps every rifle grip on the rifle and inside the arm reach', () => {
    for (const c of Object.values(RIFLE_CARRIAGE)) {
      for (const side of ['left', 'right'] as const) {
        const along = c.hands[side];
        if (along === undefined) continue;
        expect(along).toBeGreaterThan(0);
        expect(along).toBeLessThanOrEqual(RIFLE.length);
        const d = distance(carriagePoint(c, along), shoulder(side === 'left' ? 'L' : 'R'));
        expect(d).toBeGreaterThanOrEqual(ARM_MIN_REACH - 1e-9);
        expect(d).toBeLessThanOrEqual(ARM_MAX_REACH + 1e-9);
      }
    }
  });

  it('keeps every colour grip on the pike and inside the arm reach', () => {
    for (const c of Object.values(COLOUR_CARRIAGE)) {
      for (const side of ['left', 'right'] as const) {
        const along = c.hands[side];
        if (along === undefined) continue;
        const d = distance(carriagePoint(c, along), shoulder(side === 'left' ? 'L' : 'R'));
        expect(d).toBeGreaterThanOrEqual(ARM_MIN_REACH - 1e-9);
        expect(d).toBeLessThanOrEqual(ARM_MAX_REACH + 1e-9);
      }
    }
  });

  it('gives a colour party the pike rather than a rifle', () => {
    const t = poseTargets(snap({ colour: 'carry' }), true, true);
    expect(t.weapon).toBeNull();
    expect(t.colour).not.toBeNull();
  });

  it('turns a shoulder swing into the angle it reports', () => {
    const rest = POSTURE_HANDS.attention.left;
    const hand = swingHand(rest, 26, 22);
    const flex = (Math.atan2(hand[2], BODY.shoulderY - hand[1]) * 180) / Math.PI;
    expect(flex).toBeCloseTo(26, 6);
    expect(distance(hand, shoulder('L'))).toBeCloseTo(distanceForElbow(22), 6);
  });
});

describe('weapon states', () => {
  it('covers every weapon state the drill engine can ask for', () => {
    const states: Exclude<WeaponState, 'none'>[] = [
      'order',
      'slope',
      'present',
      'port',
      'inspection',
      'trail',
      'grounded',
      'reversed',
      'sling',
    ];
    for (const state of states) {
      expect(RIFLE_CARRIAGE[state], state).toBeDefined();
    }
  });
});
