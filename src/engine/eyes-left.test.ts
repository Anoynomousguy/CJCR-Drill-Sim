import { describe, expect, it } from 'vitest';
import { BEAT, DEFAULT_SETTINGS } from './constants';
import { isDirectingFlank } from './individual';
import { buildTimeline, sampleTimeline } from './simulate';
import { sampleStepPlan } from './steps';
import type { Plan } from './types';

const settings: Plan['settings'] = {
  ...DEFAULT_SETTINGS,
  strength: 6,
  squads: 1,
  ranks: 2,
  colours: 0,
  commander: false,
  supernumerary: false,
  armed: false,
  uniform: 'army',
  headingDeg: 0,
};

const roster = Array.from({ length: 6 }, (_, i) => ({ id: `cadet-${i}`, height: 1.76 + i * 0.01 }));
const move = (type: string, params: Record<string, number | string> = {}) => ({ id: type, type, params });

function timelineOf(programme: Plan['programme'], over: Partial<Plan['settings']> = {}) {
  const plan: Plan = {
    version: 1,
    name: 'eyes left on the march',
    settings: { ...settings, ...over },
    roster,
    programme,
  };
  return buildTimeline(plan);
}

const timeline = timelineOf([
  move('attention'),
  move('quickMarch', { paces: 4 }),
  move('eyesLeft'),
  move('quickMarch', { paces: 2 }),
  move('eyesFrontMarch'),
  move('quickMarch', { paces: 2 }),
]);
const left = timeline.segments[2];
const middle = timeline.segments[3];
const front = timeline.segments[4];
const id = timeline.soldiers[1].id;
const at = (t: number) => sampleTimeline(timeline, left.start + t);
const frontAt = (t: number) => sampleTimeline(timeline, front.start + t);

describe('eyes left on the march', () => {
  it('marches the two paces instead of freezing the squad', () => {
    expect(left.type).toBe('eyesLeft');
    expect(left.mode).toBe('linear');
    expect(left.actionEnd - left.start).toBeCloseTo(2 * BEAT, 6);
    expect(left.steps).toBeDefined();
    // Two 75 cm paces, not a pause on the spot.
    expect(
      Math.hypot(left.toFrame.x - left.fromFrame.x, left.toFrame.z - left.fromFrame.z),
    ).toBeCloseTo(1.5, 6);
    // The command is given on the left foot: the march handing over finishes
    // with the left forward, so the first pace of the eyes left is the right's.
    const before = sampleStepPlan(timeline.segments[1].steps![id], 1);
    expect(before.left.z, 'left foot forward at the command').toBeGreaterThan(
      before.right.z + 0.2,
    );
    // The second pace lands the left foot again, as the manual counts it.
    const after = sampleStepPlan(left.steps![id], 1);
    expect(after.left.z, 'left foot lands at the end').toBeGreaterThan(after.right.z + 0.2);
    // The head is turned left, and the squad carries straight on into the next
    // march with the head still left.
    expect(left.toSnapshot.eyes).toBe('left');
    expect(middle.fromFrame.z).toBeCloseTo(left.toFrame.z, 9);
    expect(middle.fromSnapshot.eyes).toBe('left');
  });

  it('turns the head left as the left foot lands, not before', () => {
    expect(at(1e-6).eyesAmount).toBe(0);
    expect(at(0.4).eyesAmount).toBe(0);
    expect(at(0.5).eyesAmount).toBe(0);
    expect(at(0.75).eyesAmount).toBeCloseTo(0.5, 6);
    expect(at(1).eyesAmount).toBeCloseTo(1, 6);
    // Which way: left, the mirror of EYES RIGHT (Ch 3, para 89).
    expect(at(1e-6).eyesDir).toBe('left');
    expect(at(1).eyesDir).toBe('left');
    expect(at(0.5).saluteArm).toBeUndefined();
    // The head stays left through the march that follows, with no snap back.
    expect(sampleTimeline(timeline, middle.start + 0.3).eyesAmount).toBeUndefined();
  });

  it('keeps the directing flank looking to the front', () => {
    // Ch 3, para 89 c: the leading person on the directing flank keeps head
    // and eyes to the front to keep direction. The right marker is that
    // person, and this holds for either flank the squad is told to look at.
    const marker = timeline.soldiers.find((s) => s.role === 'marker')!;
    expect(marker, 'the formation has a directing flank').toBeDefined();
    expect(isDirectingFlank(marker.role)).toBe(true);
    const sample = sampleTimeline(timeline, left.actionEnd);
    expect(sample.soldiers.find((s) => s.soldier.id === marker.id)!.code.headFollow).toBe(0);
    // Everyone else turns the head at least most of the way.
    const cadets = sample.soldiers.filter((s) => s.soldier.role === 'cadet');
    expect(cadets.length).toBeGreaterThan(0);
    for (const cadet of cadets) expect(cadet.code.headFollow).toBeGreaterThan(0.5);
  });
});

describe('eyes front after an eyes left', () => {
  it('cuts the head back to the front as the left foot lands', () => {
    expect(front.type).toBe('eyesFrontMarch');
    expect(front.mode).toBe('linear');
    expect(front.fromSnapshot.eyes).toBe('left');
    expect(front.toSnapshot.eyes).toBe('front');
    expect(front.actionEnd - front.start).toBeCloseTo(2 * BEAT, 6);
    expect(front.toFrame.z - front.fromFrame.z).toBeCloseTo(1.5, 6);
    expect(frontAt(0.25).eyesAmount).toBeCloseTo(1, 6);
    expect(frontAt(0.25).eyesDir, 'still turned left while cutting').toBe('left');
    expect(frontAt(0.75).eyesAmount).toBeCloseTo(0.5, 6);
    expect(frontAt(1).eyesAmount).toBeCloseTo(0, 6);
  });

  it('does not swing the head out when no eyes order turned it', () => {
    // EYES FRONT on its own has nothing to cut; the old profile started at
    // one and turned the head right first.
    const plain = timelineOf([
      move('attention'),
      move('quickMarch', { paces: 4 }),
      move('eyesFrontMarch'),
    ]);
    const cut = plain.segments[2];
    expect(cut.fromSnapshot.eyes).toBe('front');
    expect(sampleTimeline(plain, cut.start + 1e-6).eyesAmount).toBe(0);
    expect(sampleTimeline(plain, cut.start + 0.25).eyesAmount).toBe(0);
    expect(sampleTimeline(plain, cut.actionEnd).eyesAmount).toBe(0);
  });

  it("cues the commander's salute to the left and cuts it on the right foot", () => {
    const cmd = timelineOf(
      [
        move('attention'),
        move('quickMarch', { paces: 4 }),
        move('eyesLeft'),
        move('quickMarch', { paces: 2 }),
        move('eyesFrontMarch'),
      ],
      { commander: true },
    );
    const l = cmd.segments[2];
    const f = cmd.segments[4];
    expect(sampleTimeline(cmd, l.start + 1e-6).commanderSalute).toBeCloseTo(0, 6);
    expect(sampleTimeline(cmd, l.start + 0.75).commanderSalute).toBeCloseTo(0.5, 6);
    expect(sampleTimeline(cmd, l.actionEnd).commanderSalute).toBeCloseTo(1, 6);
    expect(sampleTimeline(cmd, f.start + 0.25).commanderSalute).toBeCloseTo(0.5, 6);
    expect(sampleTimeline(cmd, f.start + 0.5).commanderSalute).toBe(0);
  });
});
