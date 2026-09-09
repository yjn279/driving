/**
 * 車両座標系への変換と荷重の向き（`docs/developer/specification.mdx`「座標系と荷重」）。
 *
 * 車両座標系は右手系で、forward = 前方・right = 右方・up = 鉛直上向き・right = forward × up。
 * 荷重は加速度の逆向き（load = -a）。
 */

import { cross, dot, normalize, scale, subtract, type Vector3 } from './vector';

/** 重力加速度。m/s²。荷重・加速度を g 単位へ換算する基準値。 */
export const GRAVITY_MS2 = 9.81;

export type VehicleFrame = {
  readonly forward: Vector3;
  readonly right: Vector3;
  readonly up: Vector3;
};

/** 車両座標系での加速度。前方・右方が正、m/s²。 */
export type VehicleAcceleration = {
  readonly ax: number;
  readonly ay: number;
};

/** 荷重ベクトルの前後・左右成分。前方・右方が正。 */
export type Load = {
  readonly front: number;
  readonly right: number;
};

/**
 * 静止フェーズで得た重力ベクトルの平均と、加速フェーズで得たユーザー加速度の平均から
 * 車両座標系を組み立てる。
 *
 * 加速の平均方向が up とほぼ平行で水平成分が取れないときは、代替値を返さずに例外を投げる。
 */
export function buildVehicleFrame(gravityAverage: Vector3, accelerationAverage: Vector3): VehicleFrame {
  const up = normalize(scale(gravityAverage, -1));

  // accelerationAverage から up 方向の成分を取り除き、水平成分だけを forward とする。
  const horizontal = subtract(accelerationAverage, scale(up, dot(accelerationAverage, up)));
  if (dot(horizontal, horizontal) < 1e-12) {
    throw new Error('加速度の平均が鉛直方向に近く、車両の前方を決定できません');
  }
  const forward = normalize(horizontal);
  const right = normalize(cross(forward, up));

  return { forward, right, up };
}

/** 端末座標系のユーザー加速度を、車両座標系の前方・右方成分へ変換する。 */
export function toVehicleAcceleration(frame: VehicleFrame, acceleration: Vector3): VehicleAcceleration {
  return {
    ax: dot(acceleration, frame.forward),
    ay: dot(acceleration, frame.right),
  };
}

/** 車両座標系の加速度から荷重（load = -a）を求める。 */
export function loadFromAcceleration(acceleration: VehicleAcceleration): Load {
  return { front: -acceleration.ax, right: -acceleration.ay };
}
