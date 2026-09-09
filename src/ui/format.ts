/**
 * 画面をまたいで使う表示用の整形関数。
 */

/** メートルを「◯ m」または「◯.◯ km」に整形する。 */
export function formatDistanceM(distanceM: number): string {
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(1)} km`;
  return `${Math.round(distanceM)} m`;
}
