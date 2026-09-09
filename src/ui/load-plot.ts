/**
 * 荷重を円形の図（矢印・G-G ダイアグラム）へ描くときに共通する設定。
 */

import { GRAVITY_MS2, type Load } from '../core/vehicle-frame';

/** この大きさ（g）で描画が円の縁いっぱいまで伸びる。 */
export const MAX_LOAD_G = 1;

/** 円の縁とラベルの間に空ける余白（px）。 */
const PLOT_MARGIN = 24;

/** 円形の荷重プロット（矢印・G-G ダイアグラム）に共通する中心と半径を求める。 */
export function plotGeometry(size: number): { readonly center: number; readonly plotRadius: number } {
  const center = size / 2;
  return { center, plotRadius: center - PLOT_MARGIN };
}

/** 荷重を g 単位の前後・左右成分へ変換する。 */
export function toLoadG(load: Load): { readonly frontG: number; readonly rightG: number } {
  return { frontG: load.front / GRAVITY_MS2, rightG: load.right / GRAVITY_MS2 };
}
