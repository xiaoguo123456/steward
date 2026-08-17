import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { Host, Slider } from '@expo/ui';
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

type AppSliderProps = ComponentProps<typeof Slider> & {
  style?: StyleProp<ViewStyle>;
};

export function AppSlider({ style, ...props }: AppSliderProps) {
  return (
    <Host
      colorScheme="light"
      matchContents={{ vertical: true }}
      seedColor={colors.primary}
      style={[styles.sliderHost, style]}
    >
      <Slider {...props} />
    </Host>
  );
}

const styles = StyleSheet.create({
  sliderHost: {
    width: '100%',
    justifyContent: 'center',
  },
});
