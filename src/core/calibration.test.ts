import { describe, expect, it } from 'vitest';
import type { Vector3 } from './vector';
import { evaluateAcceleration, evaluateStillness, upFromGravityAverage, type TimedSample } from './calibration';

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

describe('evaluateAcceleration', () => {
  it('水平成分1.5 m/s²以上・向きのばらつき15°以内が2秒続くと加速が成立する', () => {
    const result = evaluateAcceleration(acceleratingSamples(101), UP);
    expect(result).toBeDefined();
    expect(result!.y).toBeCloseTo(3, 0);
  });

  it('水平成分が1.5 m/s²に届かない場合は加速が成立しない', () => {
    const result = evaluateAcceleration(acceleratingSamples(101, { horizontalY: 1 }), UP);
    expect(result).toBeUndefined();
  });

  it('向きが15°を超えて振れる場合は加速が成立しない', () => {
    const samples: TimedSample[] = Array.from({ length: 101 }, (_, i) => ({
      t: i * SPACING_MS,
      // atan(1.6 / 3) ≈ 28.1° で、平均方向（y 軸寄り）から左右に振れ続ける。
      acceleration: { x: i % 2 === 0 ? 1.6 : -1.6, y: 3, z: -9.81 },
    }));
    const result = evaluateAcceleration(samples, UP);
    expect(result).toBeUndefined();
  });
});
