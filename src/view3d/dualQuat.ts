// Dual-quaternion skin deformation.
//
// Linear-blend skinning blends the four bone matrices entry by entry. That is
// not a rotation: half way through a 150-degree shoulder raise the blended
// matrix has scaled one axis by cos(75°), so the sleeve narrows to a wedge at
// the joint and the shoulder cap caves in. The same collapse pinches the trouser
// at the hip. This is the "candy wrapper" defect, and it is a property of the
// blend, not of the pose.
//
// A dual quaternion carries a rigid screw motion (rotation plus translation)
// instead of a matrix. Blending them and re-normalising yields another rigid
// motion, so the cross-section keeps its perimeter however far the joint has
// turned. This module holds the blend twice: once as GLSL for the live skin, and
// once in TypeScript for the check in skin-deformation.test.ts. Both are written
// from the same formulas, in the same order, so the test measures the maths the
// GPU runs.

import type * as THREE from 'three';

export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

/** Rotation quaternion in the real part, the translation in the dual part. */
export interface DualQuat {
  real: Quat;
  dual: Quat;
}

export const IDENTITY_DQ: DualQuat = { real: [0, 0, 0, 1], dual: [0, 0, 0, 0] };

const dot4 = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** Column of a column-major matrix, normalised so scale cannot skew the quat. */
function column(e: ArrayLike<number>, offset: number): Vec3 {
  const x = e[offset];
  const y = e[offset + 1];
  const z = e[offset + 2];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/**
 * Rotation of a (rigid, optionally uniformly scaled) matrix, mirroring
 * `dqRotation` in the shader below. Degenerate branches take the largest
 * diagonal, which is what keeps a 180-degree rotation numerically stable.
 */
export function quaternionFromMatrix(e: ArrayLike<number>): Quat {
  const c0 = column(e, 0);
  const c1 = column(e, 4);
  const c2 = column(e, 8);
  const m00 = c0[0];
  const m10 = c0[1];
  const m20 = c0[2];
  const m01 = c1[0];
  const m11 = c1[1];
  const m21 = c1[2];
  const m02 = c2[0];
  const m12 = c2[1];
  const m22 = c2[2];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
  ];
}

/** Dual quaternion for a bone matrix: q_d = ½ · t · q_r. */
export function dualQuatFromMatrix(e: ArrayLike<number>): DualQuat {
  const real = quaternionFromMatrix(e);
  const t: Quat = [e[12], e[13], e[14], 0];
  const d = quatMul(t, real);
  return { real, dual: [d[0] * 0.5, d[1] * 0.5, d[2] * 0.5, d[3] * 0.5] };
}

/**
 * Weighted blend with the sign of each dual quaternion chosen against the first
 * non-zero influence, then re-normalised (unit real part, dual part orthogonal
 * to it). Two bones 160 degrees apart then blend to one rigid rotation instead
 * of cancelling each other.
 */
export function blendDualQuats(samples: { dq: DualQuat; weight: number }[]): DualQuat {
  let total = 0;
  let reference: Quat | null = null;
  const real: Quat = [0, 0, 0, 0];
  const dual: Quat = [0, 0, 0, 0];
  for (const { dq, weight } of samples) {
    if (weight <= 0) continue;
    total += weight;
    if (!reference) reference = dq.real;
    const sign = dot4(dq.real, reference) < 0 ? -1 : 1;
    for (let i = 0; i < 4; i += 1) {
      real[i] += dq.real[i] * weight * sign;
      dual[i] += dq.dual[i] * weight * sign;
    }
  }
  if (!total) return IDENTITY_DQ;
  const len = Math.hypot(real[0], real[1], real[2], real[3]);
  if (len < 1e-8) return IDENTITY_DQ;
  const inv = 1 / len;
  for (let i = 0; i < 4; i += 1) {
    real[i] *= inv;
    dual[i] *= inv;
  }
  const along = dot4(real, dual);
  for (let i = 0; i < 4; i += 1) dual[i] -= real[i] * along;
  return { real, dual };
}

/** Rotate a vector by the real part only. */
export function rotateVector(dq: DualQuat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = dq.real;
  const ix = qy * v[2] - qz * v[1] + qw * v[0];
  const iy = qz * v[0] - qx * v[2] + qw * v[1];
  const iz = qx * v[1] - qy * v[0] + qw * v[2];
  return [
    v[0] + 2 * (qy * iz - qz * iy),
    v[1] + 2 * (qz * ix - qx * iz),
    v[2] + 2 * (qx * iy - qy * ix),
  ];
}

/** Apply the full screw motion: rotation, then the dual-quaternion translation. */
export function transformPoint(dq: DualQuat, v: Vec3): Vec3 {
  const r = rotateVector(dq, v);
  const [qx, qy, qz, qw] = dq.real;
  const [dx, dy, dz, dw] = dq.dual;
  return [
    r[0] + 2 * (qw * dx - dw * qx + qy * dz - qz * dy),
    r[1] + 2 * (qw * dy - dw * qy + qz * dx - qx * dz),
    r[2] + 2 * (qw * dz - dw * qz + qx * dy - qy * dx),
  ];
}

// ---------------------------------------------------------------- GLSL mirror
// Injected once at the top of the vertex shader, then both skinning chunks are
// replaced. `bindMatrix` is not touched in here: it is only declared by a later
// include, so the chunks do that part where the uniform is in scope.
export const DUAL_QUAT_GLSL = /* glsl */ `
vec4 dqMul( vec4 a, vec4 b ) {
  return vec4(
    a.w * b.xyz + b.w * a.xyz + cross( a.xyz, b.xyz ),
    a.w * b.w - dot( a.xyz, b.xyz )
  );
}

vec4 dqRotation( mat4 m ) {
  vec3 c0 = normalize( m[ 0 ].xyz );
  vec3 c1 = normalize( m[ 1 ].xyz );
  vec3 c2 = normalize( m[ 2 ].xyz );
  float m00 = c0.x, m10 = c0.y, m20 = c0.z;
  float m01 = c1.x, m11 = c1.y, m21 = c1.z;
  float m02 = c2.x, m12 = c2.y, m22 = c2.z;
  float trace = m00 + m11 + m22;
  vec4 q;
  if ( trace > 0.0 ) {
    float s = sqrt( trace + 1.0 ) * 2.0;
    q = vec4( ( m21 - m12 ) / s, ( m02 - m20 ) / s, ( m10 - m01 ) / s, 0.25 * s );
  } else if ( m00 > m11 && m00 > m22 ) {
    float s = sqrt( 1.0 + m00 - m11 - m22 ) * 2.0;
    q = vec4( 0.25 * s, ( m01 + m10 ) / s, ( m02 + m20 ) / s, ( m21 - m12 ) / s );
  } else if ( m11 > m22 ) {
    float s = sqrt( 1.0 + m11 - m00 - m22 ) * 2.0;
    q = vec4( ( m01 + m10 ) / s, 0.25 * s, ( m12 + m21 ) / s, ( m02 - m20 ) / s );
  } else {
    float s = sqrt( 1.0 + m22 - m00 - m11 ) * 2.0;
    q = vec4( ( m02 + m20 ) / s, ( m12 + m21 ) / s, 0.25 * s, ( m10 - m01 ) / s );
  }
  return normalize( q );
}

void dqFromMatrix( mat4 m, out vec4 real, out vec4 dual ) {
  real = dqRotation( m );
  dual = 0.5 * dqMul( vec4( m[ 3 ].xyz, 0.0 ), real );
}

void dqBlend( mat4 m0, mat4 m1, mat4 m2, mat4 m3, vec4 w, out vec4 real, out vec4 dual ) {
  vec4 r0; vec4 d0; dqFromMatrix( m0, r0, d0 );
  vec4 r1; vec4 d1; dqFromMatrix( m1, r1, d1 );
  vec4 r2; vec4 d2; dqFromMatrix( m2, r2, d2 );
  vec4 r3; vec4 d3; dqFromMatrix( m3, r3, d3 );
  if ( dot( r1, r0 ) < 0.0 ) { r1 = -r1; d1 = -d1; }
  if ( dot( r2, r0 ) < 0.0 ) { r2 = -r2; d2 = -d2; }
  if ( dot( r3, r0 ) < 0.0 ) { r3 = -r3; d3 = -d3; }
  real = w.x * r0 + w.y * r1 + w.z * r2 + w.w * r3;
  dual = w.x * d0 + w.y * d1 + w.z * d2 + w.w * d3;
  float inv = 1.0 / max( 1e-5, length( real ) );
  real *= inv;
  dual *= inv;
  dual -= real * dot( real, dual );
}

vec3 dqRotate( vec4 q, vec3 v ) {
  vec3 inner = cross( q.xyz, v ) + q.w * v;
  return v + 2.0 * cross( q.xyz, inner );
}

vec3 dqTransform( vec4 real, vec4 dual, vec3 v ) {
  return dqRotate( real, v ) + 2.0 * (
    real.w * dual.xyz - dual.w * real.xyz + cross( real.xyz, dual.xyz )
  );
}
`;

const DQ_VERTEX_CHUNK = /* glsl */ `
#ifdef USE_SKINNING
  vec4 dqReal;
  vec4 dqDual;
  dqBlend( boneMatX, boneMatY, boneMatZ, boneMatW, skinWeight, dqReal, dqDual );
  vec3 dqSkinVertex = ( bindMatrix * vec4( transformed, 1.0 ) ).xyz;
  transformed = ( bindMatrixInverse * vec4( dqTransform( dqReal, dqDual, dqSkinVertex ), 1.0 ) ).xyz;
#endif
`;

const DQ_NORMAL_CHUNK = /* glsl */ `
#ifdef USE_SKINNING
  vec4 dqNormalReal;
  vec4 dqNormalDual;
  dqBlend( boneMatX, boneMatY, boneMatZ, boneMatW, skinWeight, dqNormalReal, dqNormalDual );
  objectNormal = mat3( bindMatrixInverse ) * dqRotate( dqNormalReal, mat3( bindMatrix ) * objectNormal );
  #ifdef USE_TANGENT
    objectTangent = mat3( bindMatrixInverse ) * dqRotate( dqNormalReal, mat3( bindMatrix ) * objectTangent );
  #endif
#endif
`;

export interface SkinShader {
  vertexShader: string;
  fragmentShader: string;
}

/**
 * Replace the two linear-blend chunks with the dual-quaternion blend. Kept as a
 * pure string function so the check can assert that the live shader really was
 * replaced and no bone matrix sum is left behind.
 */
export function patchSkinShader(shader: SkinShader): SkinShader {
  const vertexShader = shader.vertexShader
    .replace('#include <skinnormal_vertex>', DQ_NORMAL_CHUNK)
    .replace('#include <skinning_vertex>', DQ_VERTEX_CHUNK);
  return {
    vertexShader: `${DUAL_QUAT_GLSL}\n${vertexShader}`,
    fragmentShader: shader.fragmentShader,
  };
}

/** Patch a skin material in place; the skinned meshes share it. */
export function useDualQuaternionSkinning(material: THREE.Material) {
  if (material.userData.dualQuaternion) return;
  material.userData.dualQuaternion = true;
  material.onBeforeCompile = (shader) => {
    const patched = patchSkinShader(shader);
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
  material.needsUpdate = true;
}
