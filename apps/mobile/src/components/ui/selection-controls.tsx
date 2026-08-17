import { SegmentedControl } from '@expo/ui/community/segmented-control';
import NativeSlider, {
  type SliderProps as NativeSliderProps,
} from '@react-native-community/slider';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, StyleSheet } from 'react-native';

import { colors } from '@/theme/tokens';

type AppSegmentedControlProps = Omit<
  ComponentProps<typeof SegmentedControl>,
  'appearance' | 'tintColor'
>;

export function AppSegmentedControl(props: AppSegmentedControlProps) {
  return (
    <SegmentedControl
      appearance="light"
      // Expo UI 的 Web 回退在设置 tintColor 时会把所有选项文字都变成白色。
      // Web 保留成熟的系统浅色外观，Android 继续使用品牌绿原生选中态。
      tintColor={Platform.OS === 'web' ? undefined : colors.primary}
      {...props}
    />
  );
}

type AppSliderProps = Omit<
  NativeSliderProps,
  | 'maximumTrackTintColor'
  | 'maximumValue'
  | 'minimumTrackTintColor'
  | 'minimumValue'
  | 'thumbSize'
  | 'thumbTintColor'
> & {
  max?: number;
  min?: number;
  style?: StyleProp<ViewStyle>;
};

export function AppSlider({ max = 1, min = 0, style, ...props }: AppSliderProps) {
  return (
    <NativeSlider
      maximumTrackTintColor={colors.borderStrong}
      maximumValue={max}
      minimumTrackTintColor={colors.primaryStrong}
      minimumValue={min}
      style={[styles.slider, style]}
      thumbSize={22}
      thumbTintColor={colors.primaryStrong}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  slider: {
    width: '100%',
    minHeight: 44,
  },
});
