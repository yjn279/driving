/**
 * 荷重を円形の図（矢印・G-G ダイアグラム）へ描くときに共通する前後左右の軸ラベル。
 */

import { Text as SvgText } from 'react-native-svg';

type Props = {
  readonly center: number;
  readonly size: number;
  readonly color: string;
};

export function PlotAxisLabels({ center, size, color }: Props) {
  return (
    <>
      <SvgText x={center} y={16} fontSize={14} fill={color} textAnchor="middle">
        前
      </SvgText>
      <SvgText x={center} y={size - 6} fontSize={14} fill={color} textAnchor="middle">
        後
      </SvgText>
      <SvgText x={14} y={center + 5} fontSize={14} fill={color} textAnchor="middle">
        左
      </SvgText>
      <SvgText x={size - 14} y={center + 5} fontSize={14} fill={color} textAnchor="middle">
        右
      </SvgText>
    </>
  );
}
