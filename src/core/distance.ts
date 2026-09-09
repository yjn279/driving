/** 緯度経度から距離を求める（haversine の公式）。走行距離の積算に使う。 */

const EARTH_RADIUS_M = 6371000;

export type LatLon = {
  readonly lat: number;
  readonly lon: number;
};

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 2 地点間の距離を球面近似で求める。単位は m。 */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const centralAngle = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_M * centralAngle;
}
