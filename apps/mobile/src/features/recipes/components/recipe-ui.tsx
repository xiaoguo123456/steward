import { Image } from 'expo-image';
import type { ComponentProps, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

import {
  mealSlotLabels,
  type MealSlot,
  type Recipe,
  type WeekDay,
  type WeekDayId,
} from '../model';
import { recipeColors } from '../theme';

export function RecipeImage({
  recipe,
  style,
}: {
  recipe: Recipe;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.imageFrame, style]}>
      <Image
        accessibilityLabel={recipe.imageDescription}
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: recipe.image }}
        style={styles.image}
        transition={180}
      />
    </View>
  );
}

export function RecipeTabs({
  value,
  onChange,
}: {
  value: 'week' | 'discover';
  onChange: (value: 'week' | 'discover') => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {(
        [
          ['week', '本周'],
          ['discover', '发现'],
        ] as const
      ).map(([id, label]) => {
        const selected = value === id;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={id}
            onPress={() => onChange(id)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
            <View style={[styles.tabIndicator, selected && styles.tabIndicatorSelected]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function WeekDateSelector({
  days,
  selectedDayId,
  onSelect,
}: {
  /** 本周七天，由服务端给出的周起始日推出，不在组件里算。 */
  days: WeekDay[];
  selectedDayId: WeekDayId;
  onSelect: (dayId: WeekDayId) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.dateSelector}>
      {days.map((day) => {
        const selected = day.id === selectedDayId;
        return (
          <Pressable
            accessibilityLabel={`${day.label}，${day.fullDate}${day.isToday ? '，今天' : ''}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={day.id}
            onPress={() => onSelect(day.id)}
            style={({ pressed }) => [
              styles.dateItem,
              selected && styles.dateItemSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.dateWeekday, selected && styles.dateTextSelected]}>
              {day.isToday ? '今' : day.weekday}
            </Text>
            <Text style={[styles.dateNumber, selected && styles.dateTextSelected]}>{day.date}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RecipePrimaryButton({
  label,
  onPress,
  icon,
  tone = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: ComponentProps<typeof AppIcon>['name'];
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const iconColor =
    tone === 'primary'
      ? colors.background
      : tone === 'danger'
        ? colors.danger
        : recipeColors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        tone === 'secondary' && styles.secondaryButton,
        tone === 'danger' && styles.dangerButton,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      {icon ? <AppIcon color={iconColor} name={icon} size={19} /> : null}
      <Text
        style={[
          styles.primaryButtonText,
          tone === 'secondary' && styles.secondaryButtonText,
          tone === 'danger' && styles.dangerButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function RecipeSectionTitle({
  title,
  aside,
  onAsidePress,
}: {
  title: string;
  aside?: string;
  onAsidePress?: () => void;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {aside && onAsidePress ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAsidePress}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.sectionAction}>{aside}</Text>
        </Pressable>
      ) : aside ? (
        <Text style={styles.sectionMeta}>{aside}</Text>
      ) : null}
    </View>
  );
}

export function NutritionStrip({
  recipes,
}: {
  recipes: Recipe[];
}) {
  const calories = recipes.reduce((total, recipe) => total + recipe.calories, 0);
  const protein = recipes.reduce((total, recipe) => total + recipe.protein, 0);
  const fiber = recipes.reduce((total, recipe) => total + recipe.fiber, 0);
  const metrics = [
    { label: '计划热量', value: `${calories}`, unit: '千卡' },
    { label: '蛋白质', value: `${protein}`, unit: '克' },
    { label: '膳食纤维', value: `${fiber}`, unit: '克' },
  ];

  return (
    <View
      accessibilityLabel={`计划摄入，${metrics
        .map((metric) => `${metric.label}${metric.value}${metric.unit}`)
        .join('，')}`}
      accessible
      style={styles.nutritionStrip}
    >
      {metrics.map((metric, index) => (
        <View
          key={metric.label}
          style={[
            styles.nutritionMetric,
            index === 1 && styles.nutritionMetricCenter,
            index === 2 && styles.nutritionMetricEnd,
          ]}
        >
          <Text style={styles.nutritionLabel}>{metric.label}</Text>
          <Text style={styles.nutritionValue}>
            {metric.value} <Text style={styles.nutritionUnit}>{metric.unit}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

export function MealRow({
  meal,
  recipe,
  onOpen,
  onSwap,
}: {
  meal: MealSlot;
  recipe: Recipe;
  onOpen: () => void;
  onSwap: () => void;
}) {
  return (
    <View style={styles.mealRow}>
      <View style={styles.mealHeader}>
        <View style={styles.mealHeading}>
          <Text accessibilityRole="header" style={styles.mealLabel}>
            {mealSlotLabels[meal]}
          </Text>
          <Text style={styles.mealCalories}>{recipe.calories} 千卡</Text>
        </View>
        <Pressable
          accessibilityLabel={`更换${mealSlotLabels[meal]}`}
          accessibilityRole="button"
          onPress={onSwap}
          style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
        >
          <AppIcon color={colors.primaryStrong} name="refresh" size={16} />
          <Text style={styles.swapText}>换一道</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityLabel={`${mealSlotLabels[meal]}，${recipe.title}，查看菜谱`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.mealMain, pressed && styles.pressed]}
      >
        <RecipeImage recipe={recipe} style={styles.mealImage} />
        <View style={styles.mealCopy}>
          <Text numberOfLines={2} style={styles.mealTitle}>
            {recipe.title}
          </Text>
          <Text numberOfLines={1} style={styles.mealMeta}>
            {recipe.timeMinutes} 分钟 · {recipe.difficulty}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

export function RecipeCard({
  recipe,
  onPress,
  style,
}: {
  recipe: Recipe;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityLabel={`${recipe.title}，${recipe.timeMinutes}分钟，查看菜谱`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.recipeCard, pressed && styles.cardPressed, style]}
    >
      <RecipeImage recipe={recipe} style={styles.cardImage} />
      <Text numberOfLines={2} style={styles.cardTitle}>
        {recipe.title}
      </Text>
      <Text numberOfLines={1} style={styles.cardMeta}>
        {recipe.timeMinutes} 分钟 · {recipe.difficulty}
      </Text>
      <Text numberOfLines={1} style={styles.cardReason}>
        {recipe.tags[0]}
      </Text>
    </Pressable>
  );
}

export function InlineNotice({
  icon,
  children,
  tone = 'mint',
}: {
  icon: ComponentProps<typeof AppIcon>['name'];
  children: ReactNode;
  tone?: 'mint' | 'warning' | 'neutral';
}) {
  const backgroundColor =
    tone === 'warning'
      ? recipeColors.warningSoft
      : tone === 'neutral'
        ? recipeColors.surfaceMuted
        : colors.primarySoft;
  const iconColor = tone === 'warning' ? recipeColors.warning : colors.primaryStrong;

  return (
    <View style={[styles.notice, { backgroundColor }]}>
      <AppIcon color={iconColor} name={icon} size={18} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function IconButton({
  label,
  icon,
  onPress,
  active = false,
}: {
  label: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        active && styles.iconButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <AppIcon
        color={active ? colors.primaryStrong : recipeColors.ink}
        name={icon}
        size={21}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  imageFrame: {
    overflow: 'hidden',
    backgroundColor: recipeColors.surfaceMuted,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  tabs: {
    height: 48,
    flexDirection: 'row',
    gap: 30,
  },
  tab: {
    minWidth: 58,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabText: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  tabTextSelected: {
    color: recipeColors.ink,
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: -StyleSheet.hairlineWidth,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  tabIndicatorSelected: {
    backgroundColor: colors.primary,
  },
  dateSelector: {
    minHeight: 70,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateItem: {
    width: 42,
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateItemSelected: {
    backgroundColor: colors.primary,
  },
  dateWeekday: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  dateNumber: {
    marginTop: 2,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dateTextSelected: {
    color: colors.background,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: recipeColors.surfaceMuted,
  },
  dangerButton: {
    backgroundColor: '#FFF0F2',
  },
  buttonDisabled: {
    backgroundColor: '#C3CDC8',
  },
  buttonPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.99 }],
  },
  primaryButtonText: {
    color: colors.background,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: recipeColors.ink,
  },
  dangerButtonText: {
    color: colors.danger,
  },
  sectionTitleRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  sectionAction: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  sectionMeta: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  nutritionStrip: {
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: recipeColors.surfaceMuted,
  },
  nutritionMetric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  nutritionMetricCenter: {
    alignItems: 'center',
  },
  nutritionMetricEnd: {
    alignItems: 'flex-end',
  },
  nutritionLabel: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  nutritionValue: {
    marginTop: 4,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  nutritionUnit: {
    color: recipeColors.muted,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '500',
  },
  mealRow: {
    gap: 8,
  },
  mealHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mealHeading: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  mealLabel: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  mealCalories: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  mealMain: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mealImage: {
    width: 96,
    height: 76,
    flexShrink: 0,
    borderRadius: radius.sm,
  },
  mealCopy: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
    justifyContent: 'center',
  },
  mealTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  mealMeta: {
    marginTop: 6,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  swapButton: {
    minWidth: 76,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  swapText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  recipeCard: {
    minWidth: 0,
  },
  cardPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.985 }],
  },
  cardImage: {
    width: '100%',
    aspectRatio: 1.12,
    borderRadius: radius.md,
  },
  cardTitle: {
    minHeight: 42,
    marginTop: 9,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  cardMeta: {
    marginTop: 3,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  cardReason: {
    marginTop: 3,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
  },
  notice: {
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
  },
  noticeText: {
    flex: 1,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: {
    backgroundColor: colors.primarySoft,
  },
  pressed: {
    opacity: 0.56,
  },
});
