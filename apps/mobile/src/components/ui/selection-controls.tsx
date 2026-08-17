import { SegmentedControl } from '@expo/ui/community/segmented-control';
import NativeSlider, {
  type SliderProps as NativeSliderProps,
} from '@react-native-community/slider';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native';

import { colors } from '@/theme/tokens';

type AppSegmentedControlProps = Omit<
  ComponentProps<typeof SegmentedControl>,
  'appearance' | 'tintColor'
>;

export function AppSegmentedControl(props: AppSegmentedControlProps) {
  return <SegmentedControl appearance="light" tintColor={colors.primary} {...props} />;
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
