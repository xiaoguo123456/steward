import { colors } from '@/theme/tokens';

// 食谱场景沿用 App 公共中性色，只保留橙色表达餐食语义。
export const recipeColors = {
  background: colors.background,
  surface: colors.surfaceRaised,
  surfaceMuted: colors.surfaceSubtle,
  ink: colors.text,
  muted: colors.textSecondary,
  faint: colors.textTertiary,
  line: colors.border,
  orange: '#D56C28',
  orangeSoft: '#FFF1E8',
  sage: colors.primarySoft,
  warningSoft: '#FFF6E5',
  warning: '#A26112',
} as const;
