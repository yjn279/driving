import { describe, expect, it } from 'vitest';
import type { Vector3 } from './vector';
import { buildVehicleFrame, loadFromAcceleration, toVehicleAcceleration } from './vehicle-frame';

// 水平・前方向きに置いた端末を想定した基準データ。
const RESTING_GRAVITY: Vector3 = { x: 0, y: 0, z: -9.81 };
const ACCELERATING_FORWARD: Vector3 = { x: 0, y: 5, z: 0 };

/** 端末を傾けて取り付けた場合を再現する、Y 軸 20°・X 軸 35° の合成回転。 */
function tilt(v: Vector3): Vector3 {
  const radY = (20 * Math.PI) / 180;
  const radX = (35 * Math.PI) / 180;

  const afterY: Vector3 = {
    x: v.x * Math.cos(radY) + v.z * Math.sin(radY),
    y: v.y,
    z: -v.x * Math.sin(radY) + v.z * Math.cos(radY),
  };

  return {
    x: afterY.x,
    y: afterY.y * Math.cos(radX) - afterY.z * Math.sin(radX),
    z: afterY.y * Math.sin(radX) + afterY.z * Math.cos(radX),
  };
}

function expectVector(actual: Vector3, expected: Vector3) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}

describe('buildVehicleFrame', () => {
  it('静止時の重力の平均から up を求める', () => {
    const frame = buildVehicleFrame(RESTING_GRAVITY, ACCELERATING_FORWARD);
    expectVector(frame.up, { x: 0, y: 0, z: 1 });
  });

  it('加速時のユーザー加速度の平均から forward を求める', () => {
    const frame = buildVehicleFrame(RESTING_GRAVITY, ACCELERATING_FORWARD);
    expectVector(frame.forward, { x: 0, y: 1, z: 0 });
  });

  it('right は forward × up になる', () => {
    const frame = buildVehicleFrame(RESTING_GRAVITY, ACCELERATING_FORWARD);
    expectVector(frame.right, { x: 1, y: 0, z: 0 });
  });

  it('加速の平均が up とほぼ平行で水平成分が取れないときは失敗する', () => {
    expect(() => buildVehicleFrame(RESTING_GRAVITY, { x: 0, y: 0, z: 5 })).toThrow();
  });
});

describe('荷重の向き', () => {
  const frame = buildVehicleFrame(RESTING_GRAVITY, ACCELERATING_FORWARD);

  it('ブレーキ（後方加速度）で荷重は前を向く', () => {
    const load = loadFromAcceleration(toVehicleAcceleration(frame, { x: 0, y: -3, z: 0 }));
    expect(load.front).toBeCloseTo(3, 9);
    expect(load.right).toBeCloseTo(0, 9);
  });

  it('加速（前方加速度）で荷重は後ろを向く', () => {
    const load = loadFromAcceleration(toVehicleAcceleration(frame, { x: 0, y: 3, z: 0 }));
    expect(load.front).toBeCloseTo(-3, 9);
    expect(load.right).toBeCloseTo(0, 9);
  });

  it('右コーナー（右方加速度）で荷重は左を向く', () => {
    const load = loadFromAcceleration(toVehicleAcceleration(frame, { x: 3, y: 0, z: 0 }));
    expect(load.front).toBeCloseTo(0, 9);
    expect(load.right).toBeCloseTo(-3, 9);
  });
});

describe('端末を傾けて取り付けた場合', () => {
  // キャリブレーション用の平均も走行中のサンプルも、同じ回転がかかった合成データとして扱う。
  const tiltedFrame = buildVehicleFrame(tilt(RESTING_GRAVITY), tilt(ACCELERATING_FORWARD));

  it('ブレーキで荷重は前を向く', () => {
    const load = loadFromAcceleration(toVehicleAcceleration(tiltedFrame, tilt({ x: 0, y: -3, z: 0 })));
    expect(load.front).toBeCloseTo(3, 6);
    expect(load.right).toBeCloseTo(0, 6);
  });

  it('加速で荷重は後ろを向く', () => {
    const load = loadFromAcceleration(toVehicleAcceleration(tiltedFrame, tilt({ x: 0, y: 3, z: 0 })));
    expect(load.front).toBeCloseTo(-3, 6);
    expect(load.right).toBeCloseTo(0, 6);
  });

  it('右コーナーで荷重は左を向く', () => {
    const load = loadFromAcceleration(toVehicleAcceleration(tiltedFrame, tilt({ x: 3, y: 0, z: 0 })));
    expect(load.front).toBeCloseTo(0, 6);
    expect(load.right).toBeCloseTo(-3, 6);
  });
});
