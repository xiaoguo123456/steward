import { type Href, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  InlineNotice,
  RecipeImage,
  RecipePrimaryButton,
} from '@/features/recipes/components/recipe-ui';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { recipeColors } from '@/features/recipes/theme';
import {
  mealSlotLabels,
  mealSlotOrder,
  type RecipeComponent,
} from '@/features/recipes/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

/** 角色标签。单品成餐不标——它本身就是一整餐，标「主食」会误导。 */
const componentLabels: Partial<Record<RecipeComponent, string>> = {
  staple: '主食',
  protein: '荤菜',
  vegetable: '素菜',
};

export default function WeekMenuScreen() {
  const router = useRouter();
  const {
    days,
    plan,
    hasPendingPlan,
    planFailure,
    planGenerating,
    planNotes,
    profileCompleted,
    swapRecipe,
    regenerateWeek,
    setSelectedDayId,
    getRecipe,
  } = useRecipePrototype();

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityLabel={planGenerating ? '正在生成本周菜单' : '重新生成本周菜单'}
            accessibilityRole="button"
            disabled={planGenerating}
            hitSlop={8}
            onPress={() => {
              if (!profileCompleted) {
                router.push('/features/recipes/questionnaire' as Href);
                return;
              }
              void regenerateWeek();
            }}
            style={({ pressed }) => [
              styles.headerIconButton,
              pressed && styles.pressed,
              planGenerating && styles.headerIconButtonBusy,
            ]}
          >
            {planGenerating ? (
              <ActivityIndicator color={colors.primaryStrong} size="small" />
            ) : (
              <AppIcon color={colors.primaryStrong} name="refresh" size={20} />
            )}
          </Pressable>
        }
        title="本周菜单"
      />

      <ScrollView
        contentContainerStyle={[styles.content, hasPendingPlan && styles.contentWithoutFooter]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>
            {days.length > 0 ? `${days[0].fullDate}—${days[days.length - 1].fullDate}` : '本周'}
          </Text>
        </View>

        {/* 只保留会影响判断的生成妥协，不重复解释预览与确认机制。 */}
        {planNotes.map((note) => (
          <InlineNotice icon="alert-circle-outline" key={`${note.kind}-${note.meal_slot ?? ''}`} tone="warning">
            {note.message}
          </InlineNotice>
        ))}

        {planFailure ? <Text style={styles.failure}>{planFailure}</Text> : null}

        <View style={styles.weekList}>
          {days.map((day) => (
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
                  const dishes = plan[day.id]?.[meal] ?? [];
                  if (dishes.length === 0) return null;
                  const total = dishes.reduce(
                    (sum, dish) => sum + (getRecipe(dish.recipeId)?.calories ?? 0),
                    0,
                  );
                  return (
                    <View key={`${day.id}-${meal}`} style={styles.dayMealGroup}>
                      <View style={styles.dayMealHeading}>
                        <Text style={styles.mealSlot}>{mealSlotLabels[meal]}</Text>
                        {/* 整餐合计：一格多道之后单道的热量说明不了什么。 */}
                        <Text style={styles.mealSlotCalories}>{Math.round(total)} 千卡</Text>
                      </View>
                      {dishes.map((dish, index) => {
                        const recipe = getRecipe(dish.recipeId);
                        if (!recipe) return null;
                        return (
                          <View key={dish.recipeId} style={styles.dayMealRow}>
                            <Pressable
                              accessibilityLabel={`${mealSlotLabels[meal]}，${recipe.title}，查看菜谱`}
                              accessibilityRole="button"
                              onPress={() =>
                                router.push(`/features/recipes/recipe/${recipe.id}` as Href)
                              }
                              style={({ pressed }) => [
                                styles.dayMealMain,
                                pressed && styles.pressed,
                              ]}
                            >
                              <RecipeImage recipe={recipe} style={styles.mealThumb} />
                              <View style={styles.mealCopy}>
                                <Text numberOfLines={1} style={styles.mealTitle}>
                                  {recipe.title}
                                </Text>
                                <Text style={styles.mealMeta}>
                                  {componentLabels[dish.component ?? 'staple'] ?? ''}
                                  {componentLabels[dish.component ?? 'staple'] ? ' · ' : ''}
                                  {recipe.timeMinutes} 分钟 · {Math.round(recipe.calories)} 千卡
                                </Text>
                              </View>
                            </Pressable>
                            <Pressable
                              accessibilityLabel={`更换${day.label}${mealSlotLabels[meal]}的${recipe.title}`}
                              accessibilityRole="button"
                              hitSlop={6}
                              onPress={() => swapRecipe(day.id, meal, index)}
                              style={({ pressed }) => [
                                styles.swapButton,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.swapText}>换一道</Text>
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {!hasPendingPlan ? (
        <View style={styles.footer}>
          <RecipePrimaryButton
            icon="cart-outline"
            label="生成整周购物清单"
            onPress={() => router.push('/features/recipes/shopping?scope=week' as Href)}
            style={styles.footerPrimary}
          />
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  failure: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 130,
  },
  contentWithoutFooter: {
    paddingBottom: 32,
  },
  headerIconButtonBusy: {
    opacity: 0.6,
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
    paddingBottom: 8,
  },
  title: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  weekList: {
    marginTop: 10,
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
  dayMealGroup: {
    gap: 8,
  },
  dayMealHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  mealSlotCalories: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
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
    minWidth: 52,
    height: 32,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  swapText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
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
  footerPrimary: {
    flex: 1.4,
  },
  pressed: {
    opacity: 0.56,
  },
});
