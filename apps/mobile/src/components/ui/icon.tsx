import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

type AppIconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export function AppIcon({ name, size = 22, color = '#1A1D1C' }: AppIconProps) {
  return <Ionicons color={color} name={name} size={size} />;
}
