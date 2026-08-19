import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  InlineNotice,
  RecipeImage,
  RecipePrimaryButton,
} from '@/features/recipes/components/recipe-ui';
import { weekDays } from '@/features/recipes/mock-data';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { recipeColors } from '@/features/recipes/theme';
import { mealSlotLabels, mealSlotOrder } from '@/features/recipes/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function WeekMenuScreen() {
  const router = useRouter();
  const {
    plan,
    hasPendingPlan,
    swapRecipe,
    regenerateWeek,
    confirmPlan,
    discardPlan,
    setSelectedDayId,
    getRecipe,
  } = useRecipePrototype();
  const [savedMessage, setSavedMessage] = useState(false);

  const confirm = () => {
    confirmPlan();
    setSavedMessage(true);
  };

  const discard = () => {
    discardPlan();
    setSavedMessage(false);
  };

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityLabel="重新生成本周菜单"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              regenerateWeek();
              setSavedMessage(false);
            }}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
          >
            <AppIcon color={colors.primaryStrong} name="refresh" size={20} />
          </Pressable>
        }
        title="本周菜单"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>
            8月17日—23日
          </Text>
          <Text style={styles.subtitle}>每天三餐都可以单独替换，确认前不会覆盖原菜单。</Text>
        </View>

        {hasPendingPlan ? (
          <InlineNotice icon="sparkles-outline" tone="warning">
            这是新的菜单预览。确认采用后，才会替换当前本周菜单。
          </InlineNotice>
        ) : savedMessage ? (
          <InlineNotice icon="checkmark-circle-outline">
            新菜单已在本次预览中采用。
          </InlineNotice>
        ) : null}

        <View style={styles.weekList}>
          {weekDays.map((day) => (
            <View key={day.id} style={styles.daySection}>
              <Pressable
                accessibilityLabel={`${day.fullDate}${day.isToday ? '，今天' : ''}，回到当天菜单`}
                accessibilityRole="button"
                onPress={() => {
                  setSelectedDayId(day.id);
                  router.back();
                }}
                style={({ pressed }) => [styles.dayHeader, pressed && styles.pressed]}
              >
                <View>
                  <Text style={styles.dayTitle}>
                    {day.label} <Text style={styles.dayDate}>{day.fullDate}</Text>
                  </Text>
                  {day.isToday ? <Text style={styles.todayLabel}>今天</Text> : null}
                </View>
                <AppIcon color={recipeColors.faint} name="chevron-forward" size={17} />
              </Pressable>

              <View style={styles.dayMeals}>
                {mealSlotOrder.map((meal) => {
                  const recipe = getRecipe(plan[day.id][meal]);
                  if (!recipe) return null;
                  return (
                    <View key={`${day.id}-${meal}`} style={styles.dayMealRow}>
                      <Pressable
                        accessibilityLabel={`${mealSlotLabels[meal]}，${recipe.title}，查看菜谱`}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push(`/features/recipes/recipe/${recipe.id}` as Href)
                        }
                        style={({ pressed }) => [styles.dayMealMain, pressed && styles.pressed]}
                      >
                        <RecipeImage recipe={recipe} style={styles.mealThumb} />
                        <View style={styles.mealCopy}>
                          <Text style={styles.mealSlot}>{mealSlotLabels[meal]}</Text>
                          <Text numberOfLines={1} style={styles.mealTitle}>
                            {recipe.title}
                          </Text>
                          <Text style={styles.mealMeta}>
                            {recipe.timeMinutes} 分钟 · {recipe.calories} 千卡
                          </Text>
                        </View>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`更换${day.label}${mealSlotLabels[meal]}`}
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={() => {
                          swapRecipe(day.id, meal);
                          setSavedMessage(false);
                        }}
                        style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
                      >
                        <AppIcon color={colors.primaryStrong} name="refresh" size={17} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {hasPendingPlan ? (
          <>
            <RecipePrimaryButton
              label="放弃更改"
              onPress={discard}
              style={styles.footerSecondary}
              tone="secondary"
            />
            <RecipePrimaryButton
              icon="checkmark-circle-outline"
              label="采用本周菜单"
              onPress={confirm}
              style={styles.footerPrimary}
            />
          </>
        ) : (
          <RecipePrimaryButton
            icon="cart-outline"
            label="生成整周购物清单"
            onPress={() => router.push('/features/recipes/shopping?scope=week' as Href)}
            style={styles.footerPrimary}
          />
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 130,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: recipeColors.surfaceMuted,
  },
  intro: {
    paddingTop: 14,
    paddingBottom: 18,
  },
  title: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 5,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  weekList: {
    marginTop: 22,
  },
  daySection: {
    marginBottom: 24,
  },
  dayHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  dayTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  dayDate: {
    color: recipeColors.muted,
    fontSize: 12,
    fontWeight: '500',
  },
  todayLabel: {
    position: 'absolute',
    left: 0,
    top: 25,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '700',
  },
  dayMeals: {
    paddingTop: 2,
  },
  dayMealRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayMealMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mealThumb: {
    width: 58,
    height: 58,
    flexShrink: 0,
    borderRadius: radius.sm,
  },
  mealCopy: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
  },
  mealSlot: {
    color: recipeColors.orange,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  mealTitle: {
    marginTop: 2,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  mealMeta: {
    marginTop: 2,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  swapButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
    backgroundColor: recipeColors.background,
  },
  footerSecondary: {
    flex: 0.8,
  },
  footerPrimary: {
    flex: 1.4,
  },
  pressed: {
    opacity: 0.56,
  },
});
