import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UNIFORMS } from '../engine/constants';
import { DEBUG_POSE_NAMES, applyDebugPose, type DebugPoseName } from './debugPose';
import {
  blendDualQuats,
  dualQuatFromMatrix,
  patchSkinShader,
  quaternionFromMatrix,
  transformPoint,
} from './dualQuat';
import { createFigure, type Figure, type FigurePalette } from './figure';

const palette = UNIFORMS.army as unknown as FigurePalette;

interface RingReport {
  mesh: string;
  /** Smallest deformed/rest ring perimeter, and where that ring sits. */
  ratio: number;
  y: number;
  /** Every loft ring, so a specific joint band can be read on its own. */
  rings: { y: number; ratio: number }[];
}

function ringReports(fig: Figure, method: 'lbs' | 'dq'): RingReport[] {
  const reports: RingReport[] = [];
  fig.group.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const geometry = mesh.geometry;
    const rings = geometry.userData.rings as number;
    const segments = geometry.userData.segments as number;
    if (!rings || !segments) throw new Error(`${mesh.name} has no ring layout`);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    mesh.skeleton.update();
    const boneMatrices = mesh.skeleton.boneMatrices!;
    const matrix = new THREE.Matrix4();
    const bind = mesh.bindMatrix;
    const bindInverse = mesh.bindMatrixInverse;
    const point = new THREE.Vector3();
    const accumulated = new THREE.Vector3();
    const deformed = new Float32Array(rings * segments * 3);

    for (let v = 0; v < rings * segments; v += 1) {
      point.fromBufferAttribute(position, v).applyMatrix4(bind);
      let moved: [number, number, number];
      if (method === 'lbs') {
        accumulated.set(0, 0, 0);
        for (let slot = 0; slot < 4; slot += 1) {
          const w = skinWeight.getComponent(v, slot);
          if (!w) continue;
          matrix.fromArray(boneMatrices, skinIndex.getComponent(v, slot) * 16);
          accumulated.addScaledVector(point.clone().applyMatrix4(matrix), w);
        }
        accumulated.applyMatrix4(bindInverse);
        moved = [accumulated.x, accumulated.y, accumulated.z];
      } else {
        const samples = [];
        for (let slot = 0; slot < 4; slot += 1) {
          const w = skinWeight.getComponent(v, slot);
          if (!w) continue;
          matrix.fromArray(boneMatrices, skinIndex.getComponent(v, slot) * 16);
          samples.push({ dq: dualQuatFromMatrix(matrix.elements), weight: w });
        }
        const dq = blendDualQuats(samples);
        const skinned = new THREE.Vector3(...transformPoint(dq, [point.x, point.y, point.z]));
        skinned.applyMatrix4(bindInverse);
        moved = [skinned.x, skinned.y, skinned.z];
      }
      deformed[v * 3] = moved[0];
      deformed[v * 3 + 1] = moved[1];
      deformed[v * 3 + 2] = moved[2];
    }

    const segment = (array: ArrayLike<number>, a: number, b: number) =>
      Math.hypot(array[a * 3] - array[b * 3], array[a * 3 + 1] - array[b * 3 + 1], array[a * 3 + 2] - array[b * 3 + 2]);
    const rest = position.array as ArrayLike<number>;
    // Skip the first and last rings: those are buried inside another part, and
    // no joint bends there. The rings in between are the body surface.
    let ratio = Infinity;
    let y = 0;
    const measured: { y: number; ratio: number }[] = [];
    for (let ring = 1; ring < rings - 1; ring += 1) {
      let restPerimeter = 0;
      let deformedPerimeter = 0;
      let height = 0;
      for (let i = 0; i < segments; i += 1) {
        const a = ring * segments + i;
        const b = ring * segments + ((i + 1) % segments);
        restPerimeter += segment(rest, a, b);
        deformedPerimeter += segment(deformed, a, b);
        height += rest[a * 3 + 1];
      }
      const here = deformedPerimeter / Math.max(1e-9, restPerimeter);
      measured.push({ y: height / segments, ratio: here });
      if (here < ratio) {
        ratio = here;
        y = height / segments;
      }
    }
    reports.push({ mesh: mesh.name, ratio, y, rings: measured });
  });
  return reports;
}

function measure(pose: DebugPoseName, method: 'lbs' | 'dq'): RingReport[] {
  const fig = createFigure({ palette, detail: 'low' }, false, false);
  applyDebugPose(fig, pose);
  const reports = ringReports(fig, method);
  fig.dispose();
  return reports;
}

const worst = (reports: RingReport[]) =>
  reports.reduce((a, b) => (b.ratio < a.ratio ? b : a));
const byMesh = (reports: RingReport[], name: string) => reports.find((r) => r.mesh === name)!;

/** Worst ring whose rest height is inside a joint band, e.g. the hip socket. */
const band = (report: RingReport, minY: number, maxY: number) =>
  report.rings.filter((r) => r.y >= minY && r.y <= maxY).reduce((a, b) => (b.ratio < a.ratio ? b : a));

describe('dual-quaternion skin', () => {
  it('replaces both linear-blend skinning chunks in the live shader', () => {
    const source = {
      vertexShader: '#include <skinnormal_vertex>\n#include <skinning_vertex>',
      fragmentShader: 'void main() {}',
    };
    const patched = patchSkinShader(source);
    expect(patched.vertexShader).toContain('void dqBlend(');
    expect(patched.vertexShader).toContain('dqBlend( boneMatX');
    expect(patched.vertexShader).not.toContain('#include <skinning_vertex>');
    expect(patched.vertexShader).not.toContain('#include <skinnormal_vertex>');
    expect(patched.vertexShader).not.toContain('skinned += boneMatX');
    expect(patched.fragmentShader).toBe(source.fragmentShader);

    // The skin the figure actually renders is patched, not just the math above.
    const fig = createFigure({ palette, detail: 'low' }, false, false);
    let meshes = 0;
    fig.group.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      meshes += 1;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      expect(material.userData.dualQuaternion, mesh.name).toBe(true);
    });
    expect(meshes).toBe(6);
    fig.dispose();
  });

  it('extracts the same rotation as the live Three quaternion', () => {
    const axes: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.4, -0.5, 0.77],
    ];
    for (const axis of axes) {
      for (const angle of [0.3, 1.2, Math.PI - 0.01, Math.PI + 0.4, -2.1]) {
        const q = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(...axis).normalize(),
          angle,
        );
        const matrix = new THREE.Matrix4().makeRotationFromQuaternion(q);
        matrix.setPosition(0.3, -1.1, 2.4);
        const got = quaternionFromMatrix(matrix.elements);
        const read = new THREE.Quaternion(got[0], got[1], got[2], got[3]);
        // q and -q are the same rotation; the blend only needs consistency.
        expect(Math.abs(read.dot(q))).toBeCloseTo(1, 6);
        const dq = dualQuatFromMatrix(matrix.elements);
        const moved = transformPoint(dq, [0.2, 0.4, -0.1]);
        const model = new THREE.Vector3(0.2, 0.4, -0.1).applyMatrix4(matrix);
        expect(moved[0]).toBeCloseTo(model.x, 5);
        expect(moved[1]).toBeCloseTo(model.y, 5);
        expect(moved[2]).toBeCloseTo(model.z, 5);
      }
    }
  });

  it('keeps every cross-section whole at the extreme poses', () => {
    for (const pose of DEBUG_POSE_NAMES) {
      const dq = measure(pose, 'dq');
      const lbs = measure(pose, 'lbs');
      for (const report of dq) {
        expect(report.ratio, `${pose} ${report.mesh} dual quaternion`).toBeGreaterThan(0.9995);
      }
      // Logged so a regression in one joint is readable in the test output.
      for (const report of lbs) {
        const dual = byMesh(dq, report.mesh);
        if (report.ratio < 0.95) {
          // eslint-disable-next-line no-console
          console.log(
            `${pose} ${report.mesh}: linear ${report.ratio.toFixed(3)} at y=${report.y.toFixed(3)}, dual ${dual.ratio.toFixed(3)}`,
          );
        }
      }
    }
  });

  it('removes the shoulder and hip pinch that linear blending produces', () => {
    const overheadLbs = measure('overhead', 'lbs');
    const overheadDq = measure('overhead', 'dq');
    for (const name of ['skin:arm.L', 'skin:arm.R']) {
      const linear = byMesh(overheadLbs, name);
      const dual = byMesh(overheadDq, name);
      // A raised arm is where a linear blend folds the deltoid to a wedge.
      expect(linear.y, `${name} pinch height`).toBeGreaterThan(1.3);
      expect(dual.ratio - linear.ratio, `${name} shoulder`).toBeGreaterThan(0.1);
    }

    const squatLbs = measure('squat', 'lbs');
    const squatDq = measure('squat', 'dq');
    for (const name of ['skin:leg.L', 'skin:leg.R']) {
      const linear = byMesh(squatLbs, name);
      const dual = byMesh(squatDq, name);
      expect(linear.y, `${name} pinch height`).toBeLessThan(1.0);
      expect(dual.ratio - linear.ratio, `${name} hip/knee`).toBeGreaterThan(0.05);
      // The hip socket is the ring band where the trouser leaves the pelvis.
      const hipLinear = band(linear, 0.87, 1.02);
      const hipDual = band(dual, 0.87, 1.02);
      expect(hipLinear.ratio, `${name} hip`).toBeLessThan(0.99);
      expect(hipDual.ratio - hipLinear.ratio, `${name} hip`).toBeGreaterThan(0.01);
    }

    const worstLbs = worst(overheadLbs);
    expect(worstLbs.ratio).toBeLessThan(0.85);
  });
});
