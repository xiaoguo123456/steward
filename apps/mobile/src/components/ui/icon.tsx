import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { Platform, View } from 'react-native';

import { colors } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

type AppIconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

const unsubscribeHydration = () => {};
const subscribeHydration = () => unsubscribeHydration;

function useCanRenderIcon() {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  return Platform.OS !== 'web' || hydrated;
}

export function AppIcon({ name, size = 22, color = '#1A1D1C' }: AppIconProps) {
  const canRender = useCanRenderIcon();

  if (!canRender) {
    return <View accessible={false} style={{ height: size, width: size }} />;
  }

  return <Ionicons accessible={false} color={color} name={name} size={size} />;
}

export type SportModeIconName = 'running' | 'walking' | 'cycling' | 'strength';

type MaterialCommunityIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const sportModeIconSpecs = {
  running: { name: 'run-fast', opticalScale: 1.02 },
  walking: { name: 'walk', opticalScale: 1 },
  cycling: { name: 'bike-fast', opticalScale: 1.08 },
  strength: { name: 'weight-lifter', opticalScale: 1.02 },
} satisfies Record<
  SportModeIconName,
  { name: MaterialCommunityIconName; opticalScale: number }
>;

type SportModeIconProps = {
  mode: SportModeIconName;
  size?: number;
  color?: string;
};

export function SportModeIcon({
  mode,
  size = 28,
  color = colors.primaryStrong,
}: SportModeIconProps) {
  const canRender = useCanRenderIcon();
  const spec = sportModeIconSpecs[mode];
  const renderedSize = Math.round(size * spec.opticalScale);

  if (!canRender) {
    return <View accessible={false} style={{ height: renderedSize, width: renderedSize }} />;
  }

  return (
    <MaterialCommunityIcons
      accessible={false}
      color={color}
      name={spec.name}
      size={renderedSize}
    />
  );
}
