/**
 * 荷重の向きを矢印で実時間表示する部品。キャリブレーションの確認段階で使う。
 * 縦軸の上を前荷重、横軸の右を右荷重とする（`docs/design.md`「座標系と荷重の定義」）。
 */

import Svg, { Circle, Line, Polygon } from 'react-native-svg';

import type { Load } from '../core/vehicle-frame';
import { MAX_LOAD_G, plotGeometry, toLoadG } from './load-plot';
import { PlotAxisLabels } from './PlotAxisLabels';

type Props = {
  readonly load: Load;
  readonly size?: number;
};

const ARROWHEAD_SIZE = 10;
const AXIS_LABEL_COLOR = '#666666';

export function LoadArrow({ load, size = 220 }: Props) {
  const { center, plotRadius } = plotGeometry(size);

  const { frontG, rightG } = toLoadG(load);
  const magnitudeG = Math.sqrt(frontG * frontG + rightG * rightG);
  const tipRadius = Math.min(magnitudeG, MAX_LOAD_G) * plotRadius;
  // 前方向を角度 0 とし、右方向へ回るほど角度が増える向きに揃える。
  const angle = Math.atan2(rightG, frontG);
  const dirX = Math.sin(angle);
  const dirY = -Math.cos(angle);

  const tipX = center + dirX * tipRadius;
  const tipY = center + dirY * tipRadius;
  const backRadius = Math.max(tipRadius - ARROWHEAD_SIZE, 0);
  const backX = center + dirX * backRadius;
  const backY = center + dirY * backRadius;
  const perpX = -dirY * (ARROWHEAD_SIZE / 2);
  const perpY = dirX * (ARROWHEAD_SIZE / 2);

  return (
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={plotRadius} stroke="#cccccc" strokeWidth={1} fill="none" />
      <PlotAxisLabels center={center} size={size} color={AXIS_LABEL_COLOR} />
      <Line x1={center} y1={center} x2={backX} y2={backY} stroke="#1a73e8" strokeWidth={4} />
      <Polygon
        points={`${tipX},${tipY} ${backX + perpX},${backY + perpY} ${backX - perpX},${backY - perpY}`}
        fill="#1a73e8"
      />
    </Svg>
  );
}
