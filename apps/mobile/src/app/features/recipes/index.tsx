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
  type RecipeComponent,
} from '@/features/recipes/model';
import { recipeColors } from '@/features/recipes/theme';
import { colors, fontFamily, radius } from '@/theme/tokens';

function recipeRoute(recipeId: string) {
  return `/features/recipes/recipe/${recipeId}` as Href;
}

type PlannedDishView = { recipe: Recipe; component?: RecipeComponent };

function WeekHomeLoading() {
  return (
    <View accessibilityLabel="正在加载本周菜单" accessibilityRole="progressbar" style={styles.loadingState}>
      <View style={styles.loadingDateRow}>
        {Array.from({ length: 7 }).map((_, index) => (
          <View key={index} style={styles.loadingDateCell} />
        ))}
      </View>
      <View style={styles.loadingTitle} />
      <View style={styles.loadingNutrition} />
      <View style={styles.loadingMeal} />
      <View style={styles.loadingMeal} />
    </View>
  );
}

function DiscoverHomeLoading() {
  return (
    <View accessibilityLabel="正在加载菜谱" accessibilityRole="progressbar" style={styles.loadingGrid}>
      {Array.from({ length: 4 }).map((_, index) => (
        <View key={index} style={styles.loadingRecipeCard}>
          <View style={styles.loadingRecipeImage} />
          <View style={styles.loadingRecipeTitle} />
          <View style={styles.loadingRecipeMeta} />
        </View>
      ))}
    </View>
  );
}

function RecipeUnavailableState({
  actionLabel = '重新加载',
  body,
  onAction,
  title,
}: {
  actionLabel?: string;
  body: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <AppIcon color={recipeColors.faint} name="cloud-offline-outline" size={27} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{body}</Text>
      <RecipePrimaryButton
        label={actionLabel}
        onPress={onAction}
        style={styles.emptyButton}
        tone="secondary"
      />
    </View>
  );
}

function WeekHome() {
  const router = useRouter();
  const {
    profile,
    profileCompleted,
    days,
    selectedDayId,
    setSelectedDayId,
    plan,
    planLoading,
    planLoadFailure,
    reloadPlan,
    planGenerating,
    planFailure,
    hasPendingPlan,
    planSaving,
    generateWeek,
    confirmPlan,
    swapRecipe,
    getRecipe,
    dailyTarget,
  } = useRecipePrototype();
  const selectedDay = days.find((day) => day.id === selectedDayId) ?? days[0];

  const generateOrCompleteProfile = () => {
    if (!profileCompleted) {
      router.push('/features/recipes/questionnaire' as Href);
      return;
    }
    void generateWeek();
  };

  const confirmOrCreateShoppingList = () => {
    if (hasPendingPlan) {
      void confirmPlan();
      return;
    }
    router.push('/features/recipes/shopping?scope=day' as Href);
  };

  if (!selectedDay) {
    if (planLoading) return <WeekHomeLoading />;
    return (
      <RecipeUnavailableState
        body={planLoadFailure ?? '服务端没有返回本周日期，请重新加载后再试。'}
        onAction={reloadPlan}
        title="本周菜单暂时无法显示"
      />
    );
  }

  // 一格是一组菜，摊平之后拿去算当天的营养合计。
  //
  // 菜谱可能还没取回来（菜单里的菜多半不在浏览列表的前 100 条里），
  // 取不到的先跳过，不渲染成空卡片。
  const dayDishes: PlannedDishView[][] = mealSlotOrder.map((meal) => {
    const out: PlannedDishView[] = [];
    for (const dish of plan[selectedDayId]?.[meal] ?? []) {
      const recipe = getRecipe(dish.recipeId);
      if (recipe) out.push({ recipe, component: dish.component });
    }
    return out;
  });
  const dayRecipes = dayDishes.flat().map((item) => item.recipe);

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

      <View style={styles.dateBlock}>
        <WeekDateSelector days={days} onSelect={setSelectedDayId} selectedDayId={selectedDayId} />
      </View>

      <RecipeSectionTitle
        aside="查看整周"
        onAsidePress={() => router.push('/features/recipes/week' as Href)}
        title={selectedDay.isToday ? '今天的菜单' : `${selectedDay.fullDate}菜单`}
      />

      <NutritionStrip recipes={dayRecipes} target={dailyTarget} />

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
            onPress={generateOrCompleteProfile}
          />
          {planFailure ? <Text style={styles.emptyPlanError}>{planFailure}</Text> : null}
        </View>
      ) : (
        <View style={styles.mealList}>
          {mealSlotOrder.map((meal, mealIndex) => {
            const dishes = dayDishes[mealIndex] ?? [];
            if (dishes.length === 0) return null;
            return (
              <MealRow
                dishes={dishes}
                key={`${selectedDayId}-${meal}`}
                meal={meal}
                onOpen={(recipeId) => router.push(recipeRoute(recipeId))}
                onSwap={(index) => swapRecipe(selectedDayId, meal, index)}
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
          disabled={hasPendingPlan && planSaving}
          label={hasPendingPlan ? (planSaving ? '正在确认…' : '确认食谱') : '生成购物清单'}
          onPress={confirmOrCreateShoppingList}
          style={styles.homeActionButton}
        />
      </View>
      {hasPendingPlan && dayRecipes.length > 0 && planFailure ? (
        <Text style={styles.homeActionError}>{planFailure}</Text>
      ) : null}
    </>
  );
}

function DiscoverHome() {
  const router = useRouter();
  const {
    profile,
    recipes,
    recipesLoading,
    recipesLoadFailure,
    reloadRecipes,
  } = useRecipePrototype();
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
  const waitingForRecipes = recipesLoading && recipes.length === 0;
  const recipesUnavailable = Boolean(recipesLoadFailure) && recipes.length === 0;

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

      {recipesLoadFailure && recipes.length > 0 ? (
        <View style={styles.contentNotice}>
          <InlineNotice icon="cloud-offline-outline" tone="neutral">
            菜谱更新失败，正在显示已有内容。
          </InlineNotice>
        </View>
      ) : null}

      {!normalizedSearch && category === 'recommended' && featured ? (
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
        aside={waitingForRecipes ? '加载中' : `${visibleRecipes.length} 道`}
        title={normalizedSearch ? '搜索结果' : '继续浏览'}
      />

      {waitingForRecipes ? (
        <DiscoverHomeLoading />
      ) : recipesUnavailable ? (
        <RecipeUnavailableState
          body={recipesLoadFailure ?? '请检查网络后重试。'}
          onAction={reloadRecipes}
          title="菜谱暂时无法加载"
        />
      ) : visibleRecipes.length > 0 ? (
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
          <Text style={styles.emptyTitle}>
            {recipes.length === 0 ? '暂时还没有可浏览的菜谱' : '没有找到合适的菜谱'}
          </Text>
          <Text style={styles.emptyCopy}>
            {recipes.length === 0
              ? '可以稍后重新加载，或者先返回本周菜单。'
              : '试试缩短关键词，或者切换到“精选”。'}
          </Text>
          <RecipePrimaryButton
            label={recipes.length === 0 ? '重新加载' : '查看推荐'}
            onPress={() => {
              if (recipes.length === 0) {
                reloadRecipes();
                return;
              }
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
  contentNotice: {
    marginBottom: 14,
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
  homeActionError: {
    marginTop: 8,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
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
  loadingState: {
    paddingTop: 10,
    gap: 18,
  },
  loadingDateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loadingDateCell: {
    width: 38,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingTitle: {
    width: '42%',
    height: 22,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingNutrition: {
    height: 92,
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingMeal: {
    height: 104,
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 22,
  },
  loadingRecipeCard: {
    width: '48.2%',
    gap: 8,
  },
  loadingRecipeImage: {
    width: '100%',
    aspectRatio: 1.16,
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingRecipeTitle: {
    width: '78%',
    height: 18,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingRecipeMeta: {
    width: '56%',
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  pressed: {
    opacity: 0.56,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.99 }],
  },
});
