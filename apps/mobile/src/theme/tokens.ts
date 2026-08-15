import { Platform } from 'react-native';

export const colors = {
  primary: '#10B981',
  primaryStrong: '#047857',
  primarySoft: '#ECFBF3',
  primaryTrack: '#DDF6E9',
  background: '#FFFFFF',
  surfaceSubtle: '#F7F8F8',
  surface: '#F3F4F6',
  surfaceRaised: '#FFFFFF',
  text: '#1A1D1C',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  borderStrong: '#D7DDD9',
  danger: '#FF3158',
  warning: '#F59E0B',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  pink: '#EC4899',
  black: '#111827',
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const fontFamily = Platform.select({
  ios: 'PingFang SC',
  android: 'Noto Sans CJK SC',
  web: 'Inter, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
  default: undefined,
});

export const shadow = Platform.select({
  web: {
    boxShadow: '0 7px 14px rgba(11, 107, 75, 0.16)',
  },
  default: {
    shadowColor: '#0B6B4B',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 7,
  },
});
