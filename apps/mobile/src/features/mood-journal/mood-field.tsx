import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { moodColors } from '@/theme/tokens';

type MoodFieldProps = {
  seeds: number[];
  height?: number;
  compact?: boolean;
  onSelect?: (index: number) => void;
};

/**
 * 日记视觉种子的确定性只读投影。它只画几何节点与轨迹，不表达奖励、健康判断或枯萎状态。
 */
export function MoodField({ seeds, height = 190, compact = false, onSelect }: MoodFieldProps) {
  const safeSeeds = seeds.length > 0 ? seeds.slice(0, compact ? 12 : 32) : [17, 43, 71];
  return (
    <Svg accessibilityLabel={seeds.length ? `本月 ${seeds.length} 个日记节点` : '本月还没有日记节点'} height={height} viewBox="0 0 340 190" width="100%">
      {safeSeeds.map((seed, index) => {
        const x = 24 + ((seed * 37 + index * 43) % 292);
        const y = 24 + ((seed * 19 + index * 29) % 136);
        const controlX = 170 + ((seed % 7) - 3) * 20;
        const controlY = 95 + ((seed % 5) - 2) * 14;
        return (
          <Path
            d={`M 170 96 Q ${controlX} ${controlY} ${x} ${y}`}
            fill="none"
            key={`path-${seed}-${index}`}
            opacity={compact ? 0.2 : 0.27}
            stroke={moodColors.accent}
            strokeDasharray="2 5"
            strokeWidth="0.8"
          />
        );
      })}
      {!compact ? (
        <>
          <Ellipse cx="170" cy="96" fill={moodColors.atmosphere} opacity="0.38" rx="66" ry="18" rotation="28" />
          <Ellipse cx="170" cy="96" fill={moodColors.atmosphere} opacity="0.3" rx="62" ry="16" rotation="-33" />
          <Ellipse cx="170" cy="96" fill={moodColors.soft} opacity="0.46" rx="48" ry="13" rotation="68" />
        </>
      ) : null}
      {safeSeeds.map((seed, index) => {
        const x = 24 + ((seed * 37 + index * 43) % 292);
        const y = 24 + ((seed * 19 + index * 29) % 136);
        const radius = compact ? 2.4 : 3 + (seed % 4) * 0.55;
        const opacity = seeds.length ? 0.28 + (seed % 5) * 0.1 : 0.12;
        return (
          <Circle
            accessibilityLabel={onSelect ? `打开第 ${index + 1} 篇日记` : undefined}
            accessible={Boolean(onSelect)}
            cx={x}
            cy={y}
            fill={index % 3 === 0 ? moodColors.accent : moodColors.atmosphere}
            key={`node-${seed}-${index}`}
            opacity={opacity}
            onPress={onSelect ? () => onSelect(index) : undefined}
            r={radius}
          />
        );
      })}
      {!compact ? <Circle cx="170" cy="96" fill={moodColors.accent} opacity="0.78" r="5" /> : null}
    </Svg>
  );
}
