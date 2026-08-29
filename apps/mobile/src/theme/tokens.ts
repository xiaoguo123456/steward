import { Platform } from 'react-native';

export const colors = {
  // 主色会直接承载白色文字与图标，当前值通过 WCAG AA 小字号对比度。
  primary: '#07865F',
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
  danger: '#D9485F',
  dangerSoft: '#FFF0F2',
  success: '#10B981',
  warning: '#F59E0B',
  inspiration: '#3579A1',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  pink: '#EC4899',
  black: '#111827',
} as const;

export const typography = {
  page: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  detail: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '600',
  },
  section: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  meta: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
  },
  caption: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  metric: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
  },
  input: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const glass = {
  tabBarTint: 'rgba(248, 252, 250, 0.72)',
  tabBarFallback: 'rgba(248, 252, 250, 0.94)',
  tabBarOpaque: '#F8FCFA',
  tabBarBorder: 'rgba(7, 134, 95, 0.12)',
  captureTint: 'rgba(7, 134, 95, 0.76)',
  captureBorder: 'rgba(255, 255, 255, 0.78)',
} as const;

// 心情日记使用局部冰川蓝；全局导航和 Capture 继续使用品牌绿。
export const moodColors = {
  accent: '#4F8FC9',
  accentPressed: '#397DB9',
  soft: '#EAF3FA',
  atmosphere: '#DCECF7',
  border: '#D7E8F5',
  text: '#315F86',
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
