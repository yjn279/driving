/**
 * 荷重を円形の図（矢印・G-G ダイアグラム）へ描くときに共通する設定。
 */

import { GRAVITY_MS2, type Load } from '../core/vehicle-frame';

/** この大きさ（g）で描画が円の縁いっぱいまで伸びる。 */
export const MAX_LOAD_G = 1;

/** 荷重を g 単位の前後・左右成分へ変換する。 */
export function toLoadG(load: Load): { readonly frontG: number; readonly rightG: number } {
  return { frontG: load.front / GRAVITY_MS2, rightG: load.right / GRAVITY_MS2 };
}
