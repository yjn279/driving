/**
 * 3 次元ベクトルの基本演算。
 * React Native に依存しない純粋な関数群で、`src/core/` の他モジュールから使われる。
 */

export type Vector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function magnitude(v: Vector3): number {
  return Math.sqrt(dot(v, v));
}

/** 長さがほぼ 0 のベクトルは向きを持たないため、正規化できずに失敗する。 */
export function normalize(v: Vector3): Vector3 {
  const length = magnitude(v);
  if (length < 1e-9) {
    throw new Error('ゼロベクトルは正規化できません');
  }
  return scale(v, 1 / length);
}
