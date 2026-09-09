/**
 * ルートを合計 G（`sqrt(ax^2 + ay^2)` を g 単位にした値）で色分けするための配色。
 * `dataviz` スキルのいう「ordinal」（区切られた段階）に当たるため、1 つの色相を
 * 明度だけ変えた 5 段階のランプを使う（`validate_palette.js --ordinal` で検証済み）。
 * 境界は 0.1 / 0.2 / 0.3 / 0.4 g。日常的な市街地走行から強い減速・旋回までを
 * 5 段階で見分けられる刻みとして選んだ。
 */

const THRESHOLDS_G = [0.1, 0.2, 0.3, 0.4] as const;

const COLORS = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'] as const;

/** 合計 G（g 単位）を 5 段階の色へ変換する。 */
export function colorForLoadG(loadG: number): string {
  const level = THRESHOLDS_G.filter((threshold) => loadG >= threshold).length;
  return COLORS[level];
}

export type LoadColorLegendItem = {
  readonly color: string;
  readonly label: string;
};

/** 画面に表示する凡例。色と対応する G の範囲の組。 */
export function loadColorLegend(): readonly LoadColorLegendItem[] {
  return COLORS.map((color, level) => {
    const lower = level === 0 ? 0 : THRESHOLDS_G[level - 1];
    const upper: number | undefined = THRESHOLDS_G[level];
    return {
      color,
      label: upper === undefined ? `${lower.toFixed(1)}g〜` : `${lower.toFixed(1)}〜${upper.toFixed(1)}g`,
    };
  });
}
