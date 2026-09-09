/**
 * キャリブレーションの静止・加速判定（`docs/design.md`「キャリブレーション」、
 * 計画「決めたこと > 判定に使う数値」）。
 *
 * `samples` は各段階を開始してからの全履歴を時刻昇順で渡す。直近 2 秒の窓を切り出し、
 * 窓の中のサンプルがすべて条件を満たす場合にだけ、その窓の平均を返す。
 * 条件を破るサンプルが窓に含まれる限り不成立のままになるため、専用のリセット処理は持たない
 * （条件が崩れてから 2 秒経つと、そのサンプルは自然に窓の外へ出て再び成立し得る）。
 */

import { dot, magnitude, normalize, scale, subtract, type Vector3 } from './vector';

/** タイムスタンプ付きの加速度サンプル。t は段階の開始からの経過ミリ秒。 */
export type TimedSample = {
  readonly t: number;
  readonly acceleration: Vector3;
};

/** 判定に用いる窓の長さ。先頭と末尾の時刻差がこれ以上でなければ不成立とする。 */
const WINDOW_MS = 2000;

const STILLNESS_STD_DEV_MAX = 0.15;
const STILLNESS_NORM_MIN = 9.81 - 0.5;
const STILLNESS_NORM_MAX = 9.81 + 0.5;

const ACCELERATION_HORIZONTAL_MIN = 1.5;
const ACCELERATION_ANGLE_MAX_RAD = (15 * Math.PI) / 180;

/** 直近 `WINDOW_MS` の窓を切り出す。窓が `WINDOW_MS` に満たない場合は undefined。 */
function windowOf(samples: readonly TimedSample[]): readonly TimedSample[] | undefined {
  if (samples.length === 0) return undefined;
  const latestT = samples[samples.length - 1].t;
  const windowStart = latestT - WINDOW_MS;
  if (samples[0].t > windowStart) return undefined;
  return samples.filter((sample) => sample.t >= windowStart);
}

function average(vectors: readonly Vector3[]): Vector3 {
  const sum = vectors.reduce(
    (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }),
    { x: 0, y: 0, z: 0 },
  );
  return scale(sum, 1 / vectors.length);
}

function standardDeviation(values: readonly number[], mean: number): number {
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 静止フェーズの判定。直近 2 秒間、`accelerationIncludingGravity` の 3 軸すべての標準偏差が
 * 0.15 m/s² 以下で、平均のノルムが 9.81 ± 0.5 m/s² の範囲に収まっていれば成立し、
 * その窓の平均（重力ベクトル）を返す。成立しなければ undefined。
 */
export function evaluateStillness(samples: readonly TimedSample[]): Vector3 | undefined {
  const window = windowOf(samples);
  if (!window) return undefined;

  const vectors = window.map((s) => s.acceleration);
  const mean = average(vectors);

  const stdX = standardDeviation(vectors.map((v) => v.x), mean.x);
  const stdY = standardDeviation(vectors.map((v) => v.y), mean.y);
  const stdZ = standardDeviation(vectors.map((v) => v.z), mean.z);
  if (stdX > STILLNESS_STD_DEV_MAX || stdY > STILLNESS_STD_DEV_MAX || stdZ > STILLNESS_STD_DEV_MAX) {
    return undefined;
  }

  const norm = magnitude(mean);
  if (norm < STILLNESS_NORM_MIN || norm > STILLNESS_NORM_MAX) return undefined;

  return mean;
}

/** 静止フェーズで得た重力ベクトルの平均から、車両座標系の up を求める。 */
export function upFromGravityAverage(gravityAverage: Vector3): Vector3 {
  return normalize(scale(gravityAverage, -1));
}

/**
 * 加速フェーズの判定。直近 2 秒間、`up` を除いた水平成分の大きさが各サンプルとも
 * 1.5 m/s² 以上で、かつ各サンプルの水平方向が窓内の平均方向から 15° 以内に収まっていれば
 * 成立し、その窓の平均（ユーザー加速度、`up` 成分を含む生の値）を返す。成立しなければ undefined。
 */
export function evaluateAcceleration(samples: readonly TimedSample[], up: Vector3): Vector3 | undefined {
  const window = windowOf(samples);
  if (!window) return undefined;

  const horizontals = window.map((s) => subtract(s.acceleration, scale(up, dot(s.acceleration, up))));
  if (horizontals.some((h) => magnitude(h) < ACCELERATION_HORIZONTAL_MIN)) return undefined;

  const meanHorizontal = average(horizontals);
  const meanMagnitude = magnitude(meanHorizontal);
  if (meanMagnitude < 1e-9) return undefined;

  const withinAngle = horizontals.every((h) => {
    const cosAngle = dot(h, meanHorizontal) / (magnitude(h) * meanMagnitude);
    const clamped = Math.min(1, Math.max(-1, cosAngle));
    return Math.acos(clamped) <= ACCELERATION_ANGLE_MAX_RAD;
  });
  if (!withinAngle) return undefined;

  return average(window.map((s) => s.acceleration));
}
