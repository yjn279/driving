/**
 * キャリブレーションの静止・加速判定（`docs/design.md`「キャリブレーション」）。
 * 判定に使う閾値は、センサーのノイズでは満たされず、普通の停車・発進では
 * 数秒以内に満たされる大きさを狙って定めている。
 *
 * `samples` は各段階を開始してからの全履歴を時刻昇順で渡す。判定は直近の一定時間の窓に対して行う。
 *
 * 静止は停車中の判定なので、窓の中のサンプルがすべて条件を満たすことを求める。
 * 加速は走行中の判定であり、路面の凹凸やセンサーのノイズが 1 サンプルごとに乗る。
 * サンプル 1 つずつに条件を課すと、まっすぐ加速していても外れ値 1 つで不成立になるため、
 * 窓をならした値で判定する。
 */

import { dot, magnitude, normalize, scale, subtract, type Vector3 } from './vector';

/** タイムスタンプ付きの加速度サンプル。t は段階の開始からの経過ミリ秒。 */
export type TimedSample = {
  readonly t: number;
  readonly acceleration: Vector3;
};

/** 静止の判定に用いる窓の長さ。停車中なので長く取っても待ち時間の負担にならない。 */
const STILLNESS_WINDOW_MS = 2000;

const STILLNESS_STD_DEV_MAX = 0.15;
const STILLNESS_NORM_MIN = 9.81 - 0.5;
const STILLNESS_NORM_MAX = 9.81 + 0.5;

/**
 * 加速の判定に用いる窓の長さと、水平成分の平均に求める大きさ。
 *
 * 時速 10 km まで 10 m ほど走る、駐車場でも行える短く緩やかな発進で成立することを狙う。
 * この動きは 0.4 m/s² 前後の加速が数秒続く形になるため、窓を 1 秒、閾値を 0.5 m/s² とする。
 *
 * 静止フェーズの直後、つまり停車状態から動き出したところで判定するため、
 * 閾値を低くしても減速を「前」と取り違える恐れは小さい。停止状態から減速は起こらず、
 * 発進の加速が先に条件を満たすため。
 */
export const ACCELERATION_WINDOW_MS = 1000;
export const ACCELERATION_HORIZONTAL_MIN = 0.5;

/**
 * 前半と後半の平均方向に許すずれ。
 * 加速が緩いと 1 サンプルあたりのノイズが相対的に大きくなり、
 * 半分ずつの平均方向にも揺らぎが残る。まっすぐ走っているのに弾かれないよう広めに取る。
 */
const ACCELERATION_DRIFT_MAX_RAD = (30 * Math.PI) / 180;

/** 直近 `windowMs` の窓を切り出す。履歴が窓の長さに満たない場合は undefined。 */
function windowOf(samples: readonly TimedSample[], windowMs: number): readonly TimedSample[] | undefined {
  if (samples.length === 0) return undefined;
  const windowStart = samples[samples.length - 1].t - windowMs;
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

/** 2 つのベクトルのなす角。どちらかが向きを持たない場合は最大値（180°）を返す。 */
function angleBetween(a: Vector3, b: Vector3): number {
  const denominator = magnitude(a) * magnitude(b);
  if (denominator < 1e-9) return Math.PI;
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / denominator)));
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
  const window = windowOf(samples, STILLNESS_WINDOW_MS);
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
 * 加速フェーズの判定。直近 1 秒間について、`up` を除いた水平成分の平均が 0.5 m/s² 以上あり、
 * かつ向きが安定していれば成立し、その窓の平均（ユーザー加速度、`up` 成分を含む生の値）を返す。
 * 成立しなければ undefined。
 *
 * 向きの安定は、窓を前半と後半に分けたそれぞれの平均方向のずれで測る。
 * 平均どうしの比較なのでノイズは打ち消し合い、曲がりながらの加速のように
 * 向きが一方向へ動いていく場合だけを弾ける。
 */
export function evaluateAcceleration(samples: readonly TimedSample[], up: Vector3): Vector3 | undefined {
  const window = windowOf(samples, ACCELERATION_WINDOW_MS);
  if (!window) return undefined;

  const horizontals = window.map((s) => subtract(s.acceleration, scale(up, dot(s.acceleration, up))));
  if (magnitude(average(horizontals)) < ACCELERATION_HORIZONTAL_MIN) return undefined;

  const half = Math.floor(horizontals.length / 2);
  if (half === 0) return undefined;
  const firstHalf = average(horizontals.slice(0, half));
  const secondHalf = average(horizontals.slice(half));
  if (angleBetween(firstHalf, secondHalf) > ACCELERATION_DRIFT_MAX_RAD) return undefined;

  return average(window.map((s) => s.acceleration));
}

/** 加速フェーズの進み具合を画面へ出すための、直近 1 秒の水平成分の平均の大きさ。 */
export function horizontalAccelerationMagnitude(
  samples: readonly TimedSample[],
  up: Vector3,
): number | undefined {
  const window = windowOf(samples, ACCELERATION_WINDOW_MS);
  if (!window) return undefined;
  return magnitude(average(window.map((s) => subtract(s.acceleration, scale(up, dot(s.acceleration, up))))));
}
