import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  IconButton,
  InlineNotice,
  RecipeImage,
  RecipePrimaryButton,
  RecipeSectionTitle,
} from '@/features/recipes/components/recipe-ui';
import { getRecipe, weekDays } from '@/features/recipes/mock-data';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { recipeColors } from '@/features/recipes/theme';
import { useClientReady } from '@/features/recipes/use-client-ready';
import { mealSlotLabels, mealSlotOrder, type MealSlot } from '@/features/recipes/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

function MissingRecipe() {
  const router = useRouter();
  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader title="菜谱详情" />
      <View style={styles.missing}>
        <View style={styles.missingIcon}>
          <AppIcon color={recipeColors.faint} name="restaurant-outline" size={30} />
        </View>
        <Text style={styles.missingTitle}>这道菜暂时找不到</Text>
        <Text style={styles.missingCopy}>演示内容可能已经更新，可以返回继续浏览。</Text>
        <RecipePrimaryButton
          label="返回菜谱"
          onPress={() => router.replace('/features/recipes?view=discover' as Href)}
          style={styles.missingButton}
        />
      </View>
    </AppScreen>
  );
}

export default function RecipeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const recipeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const clientReady = useClientReady();
  const recipe = clientReady && recipeId ? getRecipe(recipeId) : undefined;
  const {
    favoriteIds,
    toggleFavorite,
    cookedIds,
    selectedDayId,
    setSelectedDayId,
    setRecipeForMeal,
  } = useRecipePrototype();
  const [servings, setServings] = useState(recipe?.servings ?? 1);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickedMeal, setPickedMeal] = useState<MealSlot>('dinner');
  const [added, setAdded] = useState(false);

  if (!clientReady) {
    return (
      <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
        <NavHeader title="菜谱详情" />
        <View style={styles.loadingHero} />
        <View style={styles.loadingBody}>
          <View style={styles.loadingTitle} />
          <View style={styles.loadingLine} />
          <View style={[styles.loadingLine, styles.loadingLineShort]} />
          <View style={styles.loadingPanel} />
        </View>
      </AppScreen>
    );
  }

  if (!recipe) return <MissingRecipe />;

  const favorite = favoriteIds.has(recipe.id);
  const cooked = cookedIds.has(recipe.id);
  const servingFactor = servings / recipe.servings;

  const addToPlan = () => {
    setRecipeForMeal(selectedDayId, pickedMeal, recipe.id);
    setPickerVisible(false);
    setAdded(true);
  };

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader
        right={
          <IconButton
            active={favorite}
            icon={favorite ? 'bookmark' : 'bookmark-outline'}
            label={favorite ? '取消收藏' : '收藏菜谱'}
            onPress={() => toggleFavorite(recipe.id)}
          />
        }
        title="菜谱详情"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <RecipeImage recipe={recipe} style={styles.heroImage} />

        <View style={styles.body}>
          {added ? (
            <View style={styles.addedNotice}>
              <InlineNotice icon="checkmark-circle-outline">
                已加入菜单预览，请前往本周菜单确认采用。
              </InlineNotice>
            </View>
          ) : cooked ? (
            <View style={styles.addedNotice}>
              <InlineNotice icon="restaurant-outline" tone="neutral">
                你已经在本地预览中做过这道菜。
              </InlineNotice>
            </View>
          ) : null}

          <Text accessibilityRole="header" style={styles.title}>
            {recipe.title}
          </Text>
          <Text style={styles.description}>{recipe.description}</Text>

          <View style={styles.tags}>
            {recipe.tags.map((tag) => (
              <Text key={tag} style={styles.tag}>
                {tag}
              </Text>
            ))}
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaValue}>{recipe.timeMinutes}</Text>
              <Text style={styles.metaLabel}>分钟</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaValue}>{recipe.difficulty}</Text>
              <Text style={styles.metaLabel}>难度</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaValue}>{servings}</Text>
              <Text style={styles.metaLabel}>人份</Text>
            </View>
          </View>

          <InlineNotice icon="restaurant-outline" tone="neutral">
            {recipe.recommendation}
          </InlineNotice>

          <View style={styles.section}>
            <RecipeSectionTitle aside="每份估算" title="营养信息" />
            <View style={styles.nutritionRow}>
              {[
                ['热量', `${recipe.calories} 千卡`],
                ['蛋白质', `${recipe.protein} 克`],
                ['碳水', `${recipe.carbs} 克`],
                ['膳食纤维', `${recipe.fiber} 克`],
              ].map(([label, value]) => (
                <View key={label} style={styles.nutritionItem}>
                  <Text style={styles.nutritionValue}>{value}</Text>
                  <Text style={styles.nutritionLabel}>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.estimateCopy}>营养值为演示估算，实际结果会随品牌、烹饪和份量变化。</Text>
          </View>

          <View style={styles.section}>
            <View style={styles.ingredientsHeader}>
              <RecipeSectionTitle title="食材" />
              <View style={styles.servingStepper}>
                <Pressable
                  accessibilityLabel="减少份量"
                  accessibilityRole="button"
                  disabled={servings <= 1}
                  onPress={() => setServings((current) => Math.max(1, current - 1))}
                  style={({ pressed }) => [styles.servingButton, pressed && styles.pressed]}
                >
                  <AppIcon
                    color={servings <= 1 ? recipeColors.faint : recipeColors.ink}
                    name="remove"
                    size={17}
                  />
                </Pressable>
                <Text style={styles.servingValue}>{servings} 人</Text>
                <Pressable
                  accessibilityLabel="增加份量"
                  accessibilityRole="button"
                  disabled={servings >= 6}
                  onPress={() => setServings((current) => Math.min(6, current + 1))}
                  style={({ pressed }) => [styles.servingButton, pressed && styles.pressed]}
                >
                  <AppIcon
                    color={servings >= 6 ? recipeColors.faint : recipeColors.ink}
                    name="add"
                    size={17}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.ingredientList}>
              {recipe.ingredients.map((ingredient) => (
                <View key={ingredient.id} style={styles.ingredientRow}>
                  <Text style={styles.ingredientName}>{ingredient.name}</Text>
                  <Text style={styles.ingredientAmount}>
                    {servingFactor === 1
                      ? ingredient.amount
                      : `${ingredient.amount} × ${servingFactor.toFixed(1)}`}
                  </Text>
                </View>
              ))}
            </View>

            {recipe.allergens.length > 0 ? (
              <View style={styles.allergenNotice}>
                <AppIcon color={recipeColors.warning} name="alert-circle-outline" size={18} />
                <Text style={styles.allergenText}>含有：{recipe.allergens.join('、')}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <RecipeSectionTitle
              aside={`${recipe.steps.length} 步`}
              title="烹饪步骤"
            />
            <View style={styles.stepList}>
              {recipe.steps.map((step, index) => (
                <View key={`${step.title}-${index}`} style={styles.stepRow}>
                  <Text style={styles.stepNumber}>{index + 1}</Text>
                  <View style={styles.stepCopy}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepDescription}>{step.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.sourceBlock}>
            <Text style={styles.sourceTitle}>内容来源</Text>
            <Text style={styles.sourceCopy}>
              {recipe.sourceLabel} · {recipe.imageCredit}
            </Text>
            <Text style={styles.sourceCopy}>当前仅用于前端演示，正式内容需补充授权与版本信息。</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <RecipePrimaryButton
          icon="flame-outline"
          label="开始烹饪"
          onPress={() =>
            router.push(`/features/recipes/cooking/${recipe.id}` as Href)
          }
          style={styles.footerSecondary}
          tone="secondary"
        />
        <RecipePrimaryButton
          icon="add-circle-outline"
          label="加入菜单"
          onPress={() => setPickerVisible(true)}
          style={styles.footerPrimary}
        />
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
        transparent
        visible={pickerVisible}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="关闭加入菜单"
            accessibilityRole="button"
            onPress={() => setPickerVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>加入本周菜单</Text>
                <Text style={styles.sheetCopy}>先选择日期，再选择餐次</Text>
              </View>
              <IconButton
                icon="close"
                label="关闭"
                onPress={() => setPickerVisible(false)}
              />
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetDates}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {weekDays.map((day) => {
                const selected = selectedDayId === day.id;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={day.id}
                    onPress={() => setSelectedDayId(day.id)}
                    style={[styles.sheetDate, selected && styles.sheetDateSelected]}
                  >
                    <Text style={[styles.sheetWeekday, selected && styles.sheetDateTextSelected]}>
                      {day.isToday ? '今天' : day.label}
                    </Text>
                    <Text style={[styles.sheetDateNumber, selected && styles.sheetDateTextSelected]}>
                      {day.date}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.mealOptions}>
              {mealSlotOrder.map((meal) => {
                const selected = pickedMeal === meal;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={meal}
                    onPress={() => setPickedMeal(meal)}
                    style={({ pressed }) => [styles.mealOption, pressed && styles.pressed]}
                  >
                    <Text style={styles.mealOptionText}>{mealSlotLabels[meal]}</Text>
                    <AppIcon
                      color={selected ? colors.primaryStrong : recipeColors.faint}
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                    />
                  </Pressable>
                );
              })}
            </View>

            <RecipePrimaryButton
              icon="add-circle-outline"
              label={`加入${weekDays.find((day) => day.id === selectedDayId)?.label ?? ''}${mealSlotLabels[pickedMeal]}`}
              onPress={addToPlan}
            />
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 126,
  },
  heroImage: {
    width: '100%',
    height: 254,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  addedNotice: {
    marginBottom: 16,
  },
  title: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '700',
    letterSpacing: -0.45,
  },
  description: {
    marginTop: 8,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 22,
  },
  tags: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tag: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  metaRow: {
    minHeight: 78,
    marginVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  metaItem: {
    flex: 1,
    alignItems: 'center',
  },
  metaValue: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metaLabel: {
    marginTop: 2,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
  },
  metaDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: recipeColors.line,
  },
  section: {
    marginTop: 28,
  },
  nutritionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  nutritionItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  nutritionValue: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  nutritionLabel: {
    marginTop: 3,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 9,
    lineHeight: 14,
  },
  estimateCopy: {
    marginTop: 8,
    color: recipeColors.faint,
    fontFamily,
    fontSize: 10,
    lineHeight: 16,
  },
  ingredientsHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  servingStepper: {
    minHeight: 38,
    paddingHorizontal: 3,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: recipeColors.surfaceMuted,
  },
  servingButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servingValue: {
    minWidth: 42,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  ingredientList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  ingredientRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  ingredientName: {
    flex: 1,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  ingredientAmount: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  allergenNotice: {
    minHeight: 46,
    marginTop: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: recipeColors.warningSoft,
  },
  allergenText: {
    flex: 1,
    color: recipeColors.warning,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
  },
  stepList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  stepRow: {
    minHeight: 86,
    paddingVertical: 14,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  stepNumber: {
    width: 34,
    color: recipeColors.orange,
    fontFamily,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  stepCopy: {
    flex: 1,
    minWidth: 0,
  },
  stepTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  stepDescription: {
    marginTop: 4,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 19,
  },
  sourceBlock: {
    marginTop: 30,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  sourceTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  sourceCopy: {
    marginTop: 4,
    color: recipeColors.faint,
    fontFamily,
    fontSize: 10,
    lineHeight: 16,
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
    flex: 0.9,
  },
  footerPrimary: {
    flex: 1.1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(10, 26, 20, 0.36)',
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 22,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: recipeColors.background,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: recipeColors.line,
  },
  sheetHeader: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
  },
  sheetCopy: {
    marginTop: 3,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  sheetDates: {
    gap: 8,
    paddingRight: 16,
  },
  sheetDate: {
    width: 58,
    minHeight: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: recipeColors.surfaceMuted,
  },
  sheetDateSelected: {
    backgroundColor: colors.primaryStrong,
  },
  sheetWeekday: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '600',
  },
  sheetDateNumber: {
    marginTop: 3,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sheetDateTextSelected: {
    color: colors.background,
  },
  mealOptions: {
    marginVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  mealOption: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  mealOptionText: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  missing: {
    flex: 1,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: recipeColors.surfaceMuted,
  },
  missingTitle: {
    marginTop: 16,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  missingCopy: {
    marginTop: 6,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  missingButton: {
    minWidth: 150,
    marginTop: 18,
  },
  loadingHero: {
    width: '100%',
    height: 254,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingBody: {
    paddingHorizontal: 16,
    paddingTop: 22,
  },
  loadingTitle: {
    width: '68%',
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingLine: {
    width: '100%',
    height: 15,
    marginTop: 14,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingLineShort: {
    width: '74%',
    marginTop: 8,
  },
  loadingPanel: {
    width: '100%',
    height: 82,
    marginTop: 24,
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  pressed: {
    opacity: 0.56,
  },
});
