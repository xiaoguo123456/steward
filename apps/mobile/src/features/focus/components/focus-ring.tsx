import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';

type FocusRingTone = 'focus' | 'rest' | 'complete';

type FocusRingProps = {
  progress: number;
  size: number;
  label: string;
  children: ReactNode;
  tone?: FocusRingTone;
};

export function FocusRing({
  progress,
  size,
  label,
  children,
  tone = 'focus',
}: FocusRingProps) {
  const strokeWidth = 3;
  const center = size / 2;
  const ringInset = 8;
  const ringSize = size - ringInset * 2;
  const ringRadius = ringSize / 2;
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const activeColor = tone === 'rest' ? colors.borderStrong : colors.primary;
  const trackColor = tone === 'rest' ? colors.surface : colors.primaryTrack;
  const endpointAngle = -Math.PI / 2 + normalizedProgress * Math.PI * 2;
  const endpointSize = 8;
  const endpointLeft =
    center + ringRadius * Math.cos(endpointAngle) - endpointSize / 2;
  const endpointTop =
    center + ringRadius * Math.sin(endpointAngle) - endpointSize / 2;
  const quarterColor = (minimumProgress: number) =>
    normalizedProgress > minimumProgress ? activeColor : trackColor;

  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(normalizedProgress * 100),
      }}
      style={[styles.root, { width: size, height: size, borderRadius: center }]}
    >
      <View
        accessible={false}
        style={[
          styles.track,
          {
            width: ringSize,
            height: ringSize,
            top: ringInset,
            left: ringInset,
            borderRadius: ringRadius,
            borderWidth: strokeWidth,
            borderColor: trackColor,
          },
        ]}
      />
      <View
        accessible={false}
        style={[
          styles.track,
          {
            width: ringSize,
            height: ringSize,
            top: ringInset,
            left: ringInset,
            borderRadius: ringRadius,
            borderWidth: strokeWidth,
            borderRightColor: quarterColor(0),
            borderBottomColor: quarterColor(0.25),
            borderLeftColor: quarterColor(0.5),
            borderTopColor: quarterColor(0.75),
          },
        ]}
      />
      <View
        accessible={false}
        style={[
          styles.gap,
          {
            width: Math.max(22, size * 0.1),
            top: ringInset - 2,
            left: center - Math.max(22, size * 0.1) / 2,
          },
        ]}
      />
      {normalizedProgress > 0 ? (
        <View
          accessible={false}
          style={[
            styles.endpoint,
            {
              width: endpointSize,
              height: endpointSize,
              left: endpointLeft,
              top: endpointTop,
              backgroundColor: activeColor,
            },
          ]}
        />
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
  },
  gap: {
    position: 'absolute',
    height: 11,
    backgroundColor: colors.background,
  },
  endpoint: {
    position: 'absolute',
    borderRadius: radius.pill,
  },
  content: {
    width: '76%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
