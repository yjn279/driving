/**
 * G-G ダイアグラムを描く部品。セッション詳細画面で、選択時刻の前後の荷重の軌跡を表示する。
 * 縦軸の上を前荷重、横軸の右を右荷重とする（`docs/developer/specification.mdx`「座標系と荷重」）。
 * 軌跡は時間の経過が分かるよう、古い点ほど薄く新しい点ほど濃い色で描く。
 * 最大 G の数値は表示しない（強調表示やランキング的な演出を避ける）。
 */

import Svg, { Circle, Line } from 'react-native-svg';

import type { Load } from '../core/vehicle-frame';
import { MAX_LOAD_G, plotGeometry, toLoadG } from './load-plot';
import { PlotAxisLabels } from './PlotAxisLabels';

export type GGDiagramPoint = {
  readonly t: number;
  readonly load: Load;
};

type Props = {
  /** 古い順に並んだ荷重の軌跡。 */
  readonly points: ReadonlyArray<GGDiagramPoint>;
  /** 印を置く時刻。`points` のうち最も近い時刻の点に印が付く。 */
  readonly currentT: number;
  readonly size?: number;
};

const GRID_RING_COUNT = 4;
const GRID_COLOR = '#e1e0d9';
const AXIS_LABEL_COLOR = '#898781';

/** 軌跡の色。古いほど薄い水色、新しいほど濃い青（`dataviz` スキルの sequential 配色）。 */
const TRAIL_COLOR_OLD: readonly [number, number, number] = [0x9e, 0xc5, 0xf4];
const TRAIL_COLOR_NEW: readonly [number, number, number] = [0x10, 0x42, 0x81];

function mixColor(from: readonly [number, number, number], to: readonly [number, number, number], ratio: number): string {
  const channel = (a: number, b: number) => Math.round(a + (b - a) * ratio);
  return `rgb(${channel(from[0], to[0])}, ${channel(from[1], to[1])}, ${channel(from[2], to[2])})`;
}

export function GGDiagram({ points, currentT, size = 240 }: Props) {
  const { center, plotRadius } = plotGeometry(size);

  const toPosition = (load: Load) => {
    const { frontG, rightG } = toLoadG(load);
    // 円の外へはみ出さないよう、大きさが MAX_LOAD_G を超える分は向きを保ったまま縮める。
    const magnitudeG = Math.hypot(frontG, rightG);
    const clamp = magnitudeG > MAX_LOAD_G ? MAX_LOAD_G / magnitudeG : 1;
    return {
      x: center + ((rightG * clamp) / MAX_LOAD_G) * plotRadius,
      y: center - ((frontG * clamp) / MAX_LOAD_G) * plotRadius,
    };
  };

  const currentIndex = points.reduce(
    (closest, point, index) =>
      closest === -1 || Math.abs(point.t - currentT) < Math.abs(points[closest].t - currentT) ? index : closest,
    -1,
  );
  const segmentCount = points.length - 1;

  return (
    <Svg width={size} height={size}>
      {Array.from({ length: GRID_RING_COUNT }, (_, i) => {
        const ringRadius = (plotRadius * (i + 1)) / GRID_RING_COUNT;
        return <Circle key={`ring-${i}`} cx={center} cy={center} r={ringRadius} stroke={GRID_COLOR} strokeWidth={1} fill="none" />;
      })}
      <Line x1={center} y1={center - plotRadius} x2={center} y2={center + plotRadius} stroke={GRID_COLOR} strokeWidth={1} />
      <Line x1={center - plotRadius} y1={center} x2={center + plotRadius} y2={center} stroke={GRID_COLOR} strokeWidth={1} />

      <PlotAxisLabels center={center} size={size} color={AXIS_LABEL_COLOR} />

      {points.slice(1).map((point, i) => {
        const from = toPosition(points[i].load);
        const to = toPosition(point.load);
        const ratio = segmentCount > 0 ? (i + 1) / segmentCount : 1;
        return (
          <Line
            key={point.t}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={mixColor(TRAIL_COLOR_OLD, TRAIL_COLOR_NEW, ratio)}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}

      {currentIndex >= 0 &&
        (() => {
          const { x, y } = toPosition(points[currentIndex].load);
          return <Circle cx={x} cy={y} r={6} fill="#0b0b0b" stroke="#fcfcfb" strokeWidth={2} />;
        })()}
    </Svg>
  );
}
