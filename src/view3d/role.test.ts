import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UNIFORMS } from '../engine/constants';
import { movementCode, type MovementCode } from '../engine/individual';
import type { Role, Snapshot } from '../engine/types';
import { createFigure, type Figure, type FigurePalette } from './figure';

const palette = UNIFORMS.army as unknown as FigurePalette;

const BASE: Snapshot = {
  posture: 'attention',
  weapon: 'none',
  colour: 'none',
  gait: 'halt',
  eyes: 'front',
  headdress: 'worn',
  spacing: 'close',
};

function pose(fig: Figure, snapshot: Snapshot, role: Role, dressing = false) {
  const code = movementCode({ id: `test-${role}`, role, rank: role === 'commander' ? 99 : 0 });
  for (let i = 0; i < 30; i += 1) {
    fig.animate({
      from: snapshot,
      to: snapshot,
      u: 1,
      gait: snapshot.gait,
      stride: 0,
      time: i / 60,
      eyes: snapshot.eyes,
      headdress: snapshot.headdress,
      dressing,
      role,
      code,
    });
  }
}

function headYaw(fig: Figure): number {
  const head = fig.group.getObjectByName('head');
  if (!head) throw new Error('no head bone');
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    head.getWorldQuaternion(new THREE.Quaternion()),
  );
  return (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
}

function handHeight(fig: Figure): number {
  const hand = fig.group.getObjectByName('hand.R');
  if (!hand) throw new Error('no right hand');
  return hand.getWorldPosition(new THREE.Vector3()).y;
}

function poseCode(fig: Figure, snapshot: Snapshot, code: MovementCode, stride = 0.4) {
  for (let i = 0; i < 30; i += 1) {
    fig.animate({
      from: snapshot,
      to: snapshot,
      u: 1,
      gait: snapshot.gait,
      stride,
      time: 0.5 + i / 60,
      eyes: snapshot.eyes,
      headdress: snapshot.headdress,
      role: 'cadet',
      code,
    });
  }
}

describe('position codes on the rig', () => {
  it('puts two cadets on slightly different beats', () => {
    const base = movementCode({ id: 'cadet-a', role: 'cadet', rank: 0 });
    const onBeat = createFigure({ palette, detail: 'low' }, false, false);
    const late = createFigure({ palette, detail: 'low' }, false, false);
    poseCode(onBeat, { ...BASE, gait: 'quick' }, { ...base, phase: 0 });
    poseCode(late, { ...BASE, gait: 'quick' }, { ...base, phase: 0.012 });
    const footZ = (fig: Figure) => fig.getPose().left.ankle[2];
    // 12 ms of a quick-time step is metres of foot travel apart, not zero.
    expect(Math.abs(footZ(onBeat) - footZ(late))).toBeGreaterThan(0.005);
  });
  it('turns the head on eyes right, but the directing flank keeps it front', () => {
    const cadet = createFigure({ palette, detail: 'low' }, false, false);
    pose(cadet, { ...BASE, eyes: 'right' }, 'cadet');
    const marker = createFigure({ palette, detail: 'low' }, false, false);
    pose(marker, { ...BASE, eyes: 'right' }, 'marker');

    expect(Math.abs(headYaw(cadet))).toBeGreaterThan(25);
    expect(Math.abs(headYaw(marker))).toBeLessThan(4);
  });

  it('raises the right arm in right dress, except for the marker', () => {
    const cadet = createFigure({ palette, detail: 'low' }, false, false);
    pose(cadet, BASE, 'cadet', true);
    const marker = createFigure({ palette, detail: 'low' }, false, false);
    pose(marker, BASE, 'marker', true);

    expect(handHeight(cadet)).toBeGreaterThan(1.25);
    expect(handHeight(marker)).toBeLessThan(1.05);
  });

  it('keeps the commander’s arm down during right dress', () => {
    const commander = createFigure({ palette, detail: 'low' }, false, false);
    pose(commander, { ...BASE, eyes: 'right' }, 'commander', true);
    // The commander orders the dressing and then eyes front; the salute is for
    // an eyes-right order, not for a dress.
    expect(handHeight(commander)).toBeLessThan(1.2);
  });

  it('salutes on an eyes-right when the person is in command', () => {
    const commander = createFigure({ palette, detail: 'low' }, false, false);
    pose(commander, { ...BASE, eyes: 'right' }, 'commander');
    // The salute hand sits at the brow, above the shoulder joint (~1.4 m).
    expect(handHeight(commander)).toBeGreaterThan(1.5);
  });
});
