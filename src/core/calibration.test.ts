import { describe, expect, it } from 'vitest';
import type { Vector3 } from './vector';
import {
  evaluateAcceleration,
  evaluateStillness,
  horizontalAccelerationMagnitude,
  upFromGravityAverage,
  type TimedSample,
} from './calibration';

const SPACING_MS = 20;
// 小さく変動させても標準偏差の閾値 0.15 を超えない、決め打ちのジッター列。
const JITTER = [0.02, -0.03, 0.01, -0.01, 0.03, -0.02, 0, 0.02, -0.01, 0.01];

function stillnessSamples(count: number, opts: { startT?: number; gravityZ?: number } = {}): TimedSample[] {
  const { startT = 0, gravityZ = -9.81 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    t: startT + i * SPACING_MS,
    acceleration: {
      x: JITTER[i % JITTER.length],
      y: -JITTER[(i + 4) % JITTER.length],
      z: gravityZ + JITTER[(i + 7) % JITTER.length],
    },
  }));
}

const UP: Vector3 = { x: 0, y: 0, z: 1 };

function acceleratingSamples(count: number, opts: { startT?: number; horizontalY?: number } = {}): TimedSample[] {
  const { startT = 0, horizontalY = 3 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    t: startT + i * SPACING_MS,
    acceleration: { x: JITTER[i % JITTER.length], y: horizontalY, z: -9.81 },
  }));
}

describe('evaluateStillness', () => {
  it('ばらつきが閾値以下のサンプルが2秒分揃うと静止が成立する', () => {
    // 101 サンプル・20 ms 間隔で先頭と末尾がちょうど 2000 ms 離れる。
    const result = evaluateStillness(stillnessSamples(101));
    expect(result).toBeDefined();
    expect(result!.x).toBeCloseTo(0, 0);
    expect(result!.z).toBeCloseTo(-9.81, 0);
  });

  it('2秒に満たない時点では静止が成立しない', () => {
    const result = evaluateStillness(stillnessSamples(50));
    expect(result).toBeUndefined();
  });

  it('途中に大きく外れたサンプルが1つ入ると経過がリセットされ、そこから2秒分揃うまで成立しない', () => {
    const lead = stillnessSamples(151); // t: 0..3000ms
    const outlier: TimedSample = { t: 3020, acceleration: { x: 5, y: 0, z: -9.81 } };

    // 外れ値から 800ms しか経っておらず、窓（直近2秒）にまだ外れ値が含まれる。
    const tooSoon = evaluateStillness([...lead, outlier, ...stillnessSamples(40, { startT: 3040 })]);
    expect(tooSoon).toBeUndefined();

    // 外れ値から2秒以上経ち、窓から外れ値が抜けて再び2秒分の良好なサンプルが揃う。
    const recovered = evaluateStillness([...lead, outlier, ...stillnessSamples(110, { startT: 3040 })]);
    expect(recovered).toBeDefined();
  });

  it('平均のノルムが9.81±0.5 m/s²の範囲を外れると静止が成立しない', () => {
    const result = evaluateStillness(stillnessSamples(101, { gravityZ: -7 }));
    expect(result).toBeUndefined();
  });
});

describe('upFromGravityAverage', () => {
  it('重力ベクトルの平均と逆向きの単位ベクトルを返す', () => {
    const up = upFromGravityAverage({ x: 0, y: 0, z: -9.81 });
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(0, 9);
    expect(up.z).toBeCloseTo(1, 9);
  });
});

/** 2 秒かけて水平方向が `sweepDeg` 度ぶん一方向へ回っていく加速。曲がりながらの加速を模す。 */
function curvingSamples(count: number, sweepDeg: number): TimedSample[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((-sweepDeg / 2 + (sweepDeg * i) / (count - 1)) * Math.PI) / 180;
    return {
      t: i * SPACING_MS,
      acceleration: { x: 3 * Math.sin(angle), y: 3 * Math.cos(angle), z: -9.81 },
    };
  });
}

describe('evaluateAcceleration', () => {
  it('水平成分の平均が1.5 m/s²以上で向きが安定した状態が2秒続くと加速が成立する', () => {
    const result = evaluateAcceleration(acceleratingSamples(101), UP);
    expect(result).toBeDefined();
    expect(result!.y).toBeCloseTo(3, 0);
  });

  it('水平成分の平均が1.5 m/s²に届かない場合は加速が成立しない', () => {
    const result = evaluateAcceleration(acceleratingSamples(101, { horizontalY: 1 }), UP);
    expect(result).toBeUndefined();
  });

  it('個々のサンプルが閾値を割っても、ならした値がまっすぐな加速なら成立する', () => {
    // 路面の凹凸を模して、20 サンプルに 1 つ水平成分がほぼ 0 に落ちる乱れを混ぜる。
    // サンプル 1 つずつに閾値を課すと、まっすぐ加速していてもこれで不成立になってしまう。
    const samples: TimedSample[] = Array.from({ length: 101 }, (_, i) => ({
      t: i * SPACING_MS,
      acceleration:
        i % 20 === 0
          ? { x: 0, y: 0.1, z: -9.81 }
          : { x: JITTER[i % JITTER.length], y: 3, z: -9.81 },
    }));
    const result = evaluateAcceleration(samples, UP);
    expect(result).toBeDefined();
    expect(result!.y).toBeCloseTo(2.83, 1);
  });

  it('ノイズで向きが1サンプルごとに振れても、平均の向きが動かなければ成立する', () => {
    const samples: TimedSample[] = Array.from({ length: 101 }, (_, i) => ({
      t: i * SPACING_MS,
      // atan(1.6 / 3) ≈ 28.1° で左右へ交互に振れる。平均すれば y 軸方向に揃う。
      acceleration: { x: i % 2 === 0 ? 1.6 : -1.6, y: 3, z: -9.81 },
    }));
    expect(evaluateAcceleration(samples, UP)).toBeDefined();
  });

  it('曲がりながらの加速のように向きが一方向へ動いていく場合は成立しない', () => {
    expect(evaluateAcceleration(curvingSamples(101, 40), UP)).toBeUndefined();
  });

  it('向きのずれが15°に収まる範囲なら成立する', () => {
    expect(evaluateAcceleration(curvingSamples(101, 20), UP)).toBeDefined();
  });
});

describe('horizontalAccelerationMagnitude', () => {
  it('直近2秒の水平成分の平均の大きさを返す', () => {
    expect(horizontalAccelerationMagnitude(acceleratingSamples(101), UP)).toBeCloseTo(3, 1);
  });

  it('2秒に満たない時点では値を返さない', () => {
    expect(horizontalAccelerationMagnitude(acceleratingSamples(50), UP)).toBeUndefined();
  });
});
