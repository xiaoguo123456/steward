import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  InlineNotice,
  MealRow,
  NutritionStrip,
  RecipeCard,
  RecipeImage,
  RecipePrimaryButton,
  RecipeSectionTitle,
  RecipeTabs,
  WeekDateSelector,
} from '@/features/recipes/components/recipe-ui';
import { categoryOptions } from '@/features/recipes/category-options';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { useClientReady } from '@/hooks/use-client-ready';
import {
  goalLabels,
  mealSlotOrder,
  type Recipe,
  type RecipeCategory,
} from '@/features/recipes/model';
import { recipeColors } from '@/features/recipes/theme';
import { colors, fontFamily, radius } from '@/theme/tokens';

function recipeRoute(recipeId: string) {
  return `/features/recipes/recipe/${recipeId}` as Href;
}

function WeekHome() {
  const router = useRouter();
  const {
    profile,
    days,
    selectedDayId,
    setSelectedDayId,
    plan,
    planLoading,
    planGenerating,
    planFailure,
    hasPendingPlan,
    generateWeek,
    swapRecipe,
    getRecipe,
  } = useRecipePrototype();
  const selectedDay = days.find((day) => day.id === selectedDayId) ?? days[0];
  const dayRecipes = mealSlotOrder
    .map((meal) => getRecipe(plan[selectedDayId]?.[meal] ?? ''))
    .filter((recipe): recipe is Recipe => Boolean(recipe));

  return (
    <>
      {/* 档案还在加载时不显示：先摆一个用户没选过的目标比空着更糟。 */}
      {profile ? (
        <Pressable
          accessibilityLabel={`当前目标，${goalLabels[profile.goal]}，打开饮食档案`}
          accessibilityRole="button"
          onPress={() => router.push('/features/recipes/questionnaire' as Href)}
          style={({ pressed }) => [styles.goalContext, pressed && styles.pressed]}
        >
          <View style={styles.goalCopy}>
            <Text style={styles.goalTitle}>{goalLabels[profile.goal]}</Text>
            <Text style={styles.goalMeta}>
              {profile.people} 人份 · 最多 {profile.maxCookingMinutes} 分钟
            </Text>
          </View>
          <Text style={styles.goalAction}>饮食档案</Text>
          <AppIcon color={recipeColors.muted} name="chevron-forward" size={18} />
        </Pressable>
      ) : null}

      {hasPendingPlan ? (
        <View style={styles.pendingNotice}>
          <InlineNotice icon="information-circle-outline" tone="neutral">
            新菜单待确认，确认前不会替换当前菜单。
          </InlineNotice>
        </View>
      ) : null}

      <View style={styles.dateBlock}>
        <WeekDateSelector days={days} onSelect={setSelectedDayId} selectedDayId={selectedDayId} />
      </View>

      <RecipeSectionTitle
        aside="查看整周"
        onAsidePress={() => router.push('/features/recipes/week' as Href)}
        title={selectedDay.isToday ? '今天的菜单' : `${selectedDay.fullDate}菜单`}
      />

      <NutritionStrip recipes={dayRecipes} />

      {/*
        还没有菜单时要给出口。
        以前这里什么都不渲染——页面上只剩一个空的营养条，
        用户看不出是没安排还是没加载出来，更找不到从哪开始。
      */}
      {dayRecipes.length === 0 && !planLoading ? (
        <View style={styles.emptyPlan}>
          <Text style={styles.emptyPlanTitle}>这一周还没有菜单</Text>
          <Text style={styles.emptyPlanBody}>
            按你的饮食档案排一周三餐，会避开你填过的过敏原与忌口。生成后可以逐餐替换，确认前不会保存。
          </Text>
          <RecipePrimaryButton
            disabled={planGenerating}
            icon="sparkles-outline"
            label={planGenerating ? '正在生成…' : '生成本周菜单'}
            onPress={() => void generateWeek()}
          />
          {planFailure ? <Text style={styles.emptyPlanError}>{planFailure}</Text> : null}
        </View>
      ) : (
        <View style={styles.mealList}>
          {mealSlotOrder.map((meal) => {
            const recipe = getRecipe(plan[selectedDayId][meal]);
            if (!recipe) return null;
            return (
              <MealRow
                key={`${selectedDayId}-${meal}`}
                meal={meal}
                onOpen={() => router.push(recipeRoute(recipe.id))}
                onSwap={() => swapRecipe(selectedDayId, meal)}
                recipe={recipe}
              />
            );
          })}
        </View>
      )}

      <View style={styles.homeActions}>
        <RecipePrimaryButton
          icon="calendar-outline"
          label="查看整周"
          onPress={() => router.push('/features/recipes/week' as Href)}
          style={styles.homeActionButton}
          tone="secondary"
        />
        <RecipePrimaryButton
          icon={hasPendingPlan ? 'checkmark-circle-outline' : 'cart-outline'}
          label={hasPendingPlan ? '查看并确认' : '生成购物清单'}
          onPress={() =>
            router.push(
              (hasPendingPlan
                ? '/features/recipes/week'
                : '/features/recipes/shopping?scope=day') as Href,
            )
          }
          style={styles.homeActionButton}
        />
      </View>
    </>
  );
}

function DiscoverHome() {
  const router = useRouter();
  const { profile, recipes } = useRecipePrototype();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<RecipeCategory>('recommended');
  const normalizedSearch = search.trim().toLowerCase();

  const visibleRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      const matchesCategory =
        category === 'recommended'
          ? (profile ? recipe.goals.includes(profile.goal) : false) ||
            recipe.categories.includes('recommended')
          : recipe.categories.includes(category);
      const haystack = [
        recipe.title,
        recipe.description,
        ...recipe.tags,
        ...recipe.ingredients.map((ingredient) => ingredient.name),
      ]
        .join(' ')
        .toLowerCase();
      return matchesCategory && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [category, normalizedSearch, profile, recipes]);

  // 头图取当前筛选下的第一条：内容来自服务端，不该在客户端写死某个 ID。
  const featured = visibleRecipes[0] ?? recipes[0];

  return (
    <>
      <View style={styles.searchField}>
        <AppIcon color={recipeColors.muted} name="search" size={21} />
        <TextInput
          accessibilityLabel="搜索菜名或食材"
          onChangeText={setSearch}
          placeholder="搜索菜名或食材"
          placeholderTextColor={recipeColors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          value={search}
        />
        {search ? (
          <Pressable
            accessibilityLabel="清空搜索"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setSearch('')}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <AppIcon color={recipeColors.faint} name="close-circle" size={20} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.categoryContent}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {categoryOptions.map((item) => {
          const selected = category === item.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={item.id}
              onPress={() => setCategory(item.id)}
              style={({ pressed }) => [styles.categoryItem, pressed && styles.pressed]}
            >
              <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                {item.label}
              </Text>
              <View style={[styles.categoryLine, selected && styles.categoryLineSelected]} />
            </Pressable>
          );
        })}
      </ScrollView>

      {!normalizedSearch && category === 'recommended' ? (
        <View style={styles.featuredSection}>
          <RecipeSectionTitle aside="适合当前目标" title="今日精选" />
          <Pressable
            accessibilityLabel={`${featured.title}，查看菜谱`}
            accessibilityRole="button"
            onPress={() => router.push(recipeRoute(featured.id))}
            style={({ pressed }) => [styles.featured, pressed && styles.cardPressed]}
          >
            <RecipeImage recipe={featured} style={styles.featuredImage} />
            <View style={styles.featuredCopy}>
              <Text numberOfLines={2} style={styles.featuredTitle}>
                {featured.title}
              </Text>
              <Text numberOfLines={2} style={styles.featuredMeta}>
                {featured.recommendation}
              </Text>
              <Text style={styles.featuredFacts}>
                {featured.timeMinutes} 分钟 · {featured.difficulty} · {featured.tags[0]}
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      <RecipeSectionTitle
        aside={`${visibleRecipes.length} 道`}
        title={normalizedSearch ? '搜索结果' : '继续浏览'}
      />

      {visibleRecipes.length > 0 ? (
        <View style={styles.recipeGrid}>
          {visibleRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              onPress={() => router.push(recipeRoute(recipe.id))}
              recipe={recipe}
              style={styles.gridCard}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <AppIcon color={recipeColors.faint} name="search-outline" size={27} />
          </View>
          <Text style={styles.emptyTitle}>没有找到合适的菜谱</Text>
          <Text style={styles.emptyCopy}>试试缩短关键词，或者切换到“精选”。</Text>
          <RecipePrimaryButton
            label="查看推荐"
            onPress={() => {
              setSearch('');
              setCategory('recommended');
            }}
            style={styles.emptyButton}
            tone="secondary"
          />
        </View>
      )}
    </>
  );
}

export default function RecipesHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const clientReady = useClientReady();
  const [tabOverride, setTabOverride] = useState<'week' | 'discover' | null>(null);
  const tab = tabOverride ?? (clientReady && params.view === 'discover' ? 'discover' : 'week');

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityLabel="饮食档案"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => router.push('/features/recipes/questionnaire' as Href)}
            style={({ pressed }) => [styles.headerProfile, pressed && styles.pressed]}
          >
            <AppIcon color={recipeColors.ink} name="person-outline" size={21} />
          </Pressable>
        }
        title="食谱"
      />
      <View style={styles.tabContainer}>
        <RecipeTabs onChange={setTabOverride} value={tab} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tab === 'week' ? <WeekHome /> : <DiscoverHome />}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    paddingHorizontal: 16,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 112,
  },
  headerProfile: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalContext: {
    minHeight: 68,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  goalTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  goalMeta: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  goalAction: {
    marginRight: 4,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  pendingNotice: {
    marginTop: 12,
  },
  dateBlock: {
    marginTop: 6,
  },
  mealList: {
    marginTop: 20,
    gap: 22,
  },
  emptyPlan: {
    marginTop: 20,
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 10,
  },
  emptyPlanTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyPlanBody: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  emptyPlanError: {
    color: colors.danger,
    fontFamily,
    fontSize: 13,
  },
  homeActions: {
    marginTop: 22,
    flexDirection: 'row',
    gap: 10,
  },
  homeActionButton: {
    flex: 1,
    paddingHorizontal: 10,
  },
  searchField: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: recipeColors.surfaceMuted,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingVertical: 0,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  categoryContent: {
    minHeight: 58,
    alignItems: 'stretch',
    gap: 22,
    paddingRight: 16,
  },
  categoryItem: {
    minHeight: 54,
    justifyContent: 'center',
  },
  categoryText: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  categoryTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  categoryLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 4,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  categoryLineSelected: {
    backgroundColor: colors.primary,
  },
  featuredSection: {
    marginBottom: 16,
  },
  featured: {
    minHeight: 220,
  },
  featuredImage: {
    width: '100%',
    aspectRatio: 1.82,
    borderRadius: radius.lg,
  },
  featuredCopy: {
    paddingTop: 11,
  },
  featuredTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  featuredMeta: {
    marginTop: 4,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  featuredFacts: {
    marginTop: 6,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  recipeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 22,
  },
  gridCard: {
    width: '48.2%',
  },
  emptyState: {
    minHeight: 260,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: recipeColors.surfaceMuted,
  },
  emptyTitle: {
    marginTop: 14,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  emptyCopy: {
    marginTop: 5,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  emptyButton: {
    minWidth: 140,
    marginTop: 16,
  },
  pressed: {
    opacity: 0.56,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.99 }],
  },
});
