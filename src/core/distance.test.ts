import { describe, expect, it } from 'vitest';
import { haversineDistance, type LatLon } from './distance';

const EARTH_RADIUS_M = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

describe('haversineDistance', () => {
  it('同一地点の距離は 0 になる', () => {
    const point: LatLon = { lat: 35.681236, lon: 139.767125 };
    expect(haversineDistance(point, point)).toBe(0);
  });

  it('経度が同じ（南北方向）2 地点の距離は、球面上の弧の長さ（半径 × 緯度差ラジアン）と 1 m 以内で一致する', () => {
    const a: LatLon = { lat: 35, lon: 139 };
    const b: LatLon = { lat: 35.01, lon: 139 };
    // 経度差が 0 のとき haversine は南北の弧の長さそのものになる（緯度に依らず成り立つ幾何学的な事実）。
    const expected = EARTH_RADIUS_M * toRadians(b.lat - a.lat);
    expect(haversineDistance(a, b)).toBeCloseTo(expected, 0);
  });

  it('緯度が同じ（東西方向）2 地点の距離は、緯線に沿った弧の長さ（半径 × cos(緯度) × 経度差ラジアン）と 1 m 以内で一致する', () => {
    // 緯度 60° は cos(緯度) が 0.5 になり、cos(lat) の項が欠落・誤実装された場合に結果が 2 倍ずれて検出できる。
    const a: LatLon = { lat: 60, lon: 139 };
    const b: LatLon = { lat: 60, lon: 139.01 };
    const expected = EARTH_RADIUS_M * Math.cos(toRadians(a.lat)) * toRadians(b.lon - a.lon);
    expect(haversineDistance(a, b)).toBeCloseTo(expected, 0);
  });
});
