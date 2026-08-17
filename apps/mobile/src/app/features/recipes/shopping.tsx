import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  InlineNotice,
  RecipePrimaryButton,
} from '@/features/recipes/components/recipe-ui';
import { getRecipe, weekDays } from '@/features/recipes/mock-data';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { recipeColors } from '@/features/recipes/theme';
import { useClientReady } from '@/hooks/use-client-ready';
import {
  ingredientGroupLabels,
  mealSlotOrder,
  type IngredientGroup,
  type ShoppingItem,
} from '@/features/recipes/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

const groupOrder: IngredientGroup[] = ['produce', 'protein', 'staple', 'seasoning'];

function parseAmount(amount: string) {
  const fractionMatch = amount.match(/^(半|四分之一)(个|根)$/);
  if (fractionMatch) {
    return {
      value: fractionMatch[1] === '半' ? 0.5 : 0.25,
      unit: fractionMatch[2],
    };
  }

  const numericMatch = amount.match(/^(\d+(?:\.\d+)?)\s*(克|个|片|根|茶匙|汤匙)$/);
  if (!numericMatch) return null;
  const value = Number(numericMatch[1]);
  const unit = numericMatch[2];
  if (unit === '汤匙') return { value: value * 3, unit: '茶匙' };
  return { value, unit };
}

function formatTotal(value: number, unit: string) {
  if (unit === '茶匙' && value >= 3 && value % 3 === 0) {
    return `${value / 3} 汤匙`;
  }
  if (unit === '个' && value === 0.5) return '半个';
  if (unit === '根' && value === 0.5) return '半根';
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1));
  return `${rounded} ${unit}`;
}

function mergeAmounts(amountCounts: Map<string, number>) {
  const entries = Array.from(amountCounts.entries());
  if (entries.every(([amount]) => amount === '少许')) return '适量';

  const parsed = entries.map(([amount, count]) => {
    const result = parseAmount(amount);
    return result ? { ...result, value: result.value * count } : null;
  });

  if (parsed.every((item) => item !== null)) {
    const units = new Set(parsed.map((item) => item.unit));
    if (units.size === 1) {
      const unit = parsed[0].unit;
      const total = parsed.reduce((sum, item) => sum + item.value, 0);
      return formatTotal(total, unit);
    }
  }

  return entries
    .map(([amount, count]) => (count > 1 ? `${amount} × ${count}` : amount))
    .join(' + ');
}

function buildShoppingItems(recipeIds: string[]): ShoppingItem[] {
  const items = new Map<
    string,
    ShoppingItem & { amountCounts: Map<string, number> }
  >();

  recipeIds.forEach((recipeId) => {
    const recipe = getRecipe(recipeId);
    if (!recipe) return;
    recipe.ingredients.forEach((ingredient) => {
      const key = `${ingredient.group}-${ingredient.name}`;
      const current = items.get(key) ?? {
        id: key,
        name: ingredient.name,
        amount: ingredient.amount,
        group: ingredient.group,
        sources: [],
        amountCounts: new Map<string, number>(),
      };
      current.amountCounts.set(
        ingredient.amount,
        (current.amountCounts.get(ingredient.amount) ?? 0) + 1,
      );
      if (!current.sources.includes(recipe.title)) current.sources.push(recipe.title);
      items.set(key, current);
    });
  });

  return Array.from(items.values()).map((item) => ({
    id: item.id,
    name: item.name,
    group: item.group,
    sources: item.sources,
    amount: mergeAmounts(item.amountCounts),
  }));
}

export default function RecipeShoppingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scope?: string }>();
  const clientReady = useClientReady();
  const scope = clientReady && params.scope === 'week' ? 'week' : 'day';
  const { plan, selectedDayId, hasPendingPlan } = useRecipePrototype();
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set(['seasoning-低盐生抽']));
  const [created, setCreated] = useState(false);

  const recipeIds = useMemo(() => {
    const dayIds = scope === 'week' ? weekDays.map((day) => day.id) : [selectedDayId];
    return dayIds.flatMap((dayId) => mealSlotOrder.map((meal) => plan[dayId][meal]));
  }, [plan, scope, selectedDayId]);

  const items = useMemo(() => buildShoppingItems(recipeIds), [recipeIds]);
  const selectedCount = items.length - ownedIds.size;

  const toggleOwned = (itemId: string) => {
    setOwnedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  if (created) {
    return (
      <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
        <NavHeader title="购物清单" />
        <View style={styles.successState}>
          <View style={styles.successIcon}>
            <AppIcon color={colors.background} name="checkmark" size={34} />
          </View>
          <Text accessibilityRole="header" style={styles.successTitle}>购物清单已准备好</Text>
          <Text style={styles.successCopy}>
            已准备好 {selectedCount} 项食材，可前往购物清单继续调整。
          </Text>
          <RecipePrimaryButton
            icon="cart-outline"
            label="查看购物清单"
            onPress={() =>
              router.replace({ pathname: '/features/[slug]', params: { slug: 'shopping' } } as Href)
            }
            style={styles.successButton}
          />
          <RecipePrimaryButton
            label="返回食谱"
            onPress={() => router.replace('/features/recipes' as Href)}
            style={styles.successButton}
            tone="secondary"
          />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader title="确认购物食材" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>
            {scope === 'week' ? '本周需要准备什么' : '今天需要准备什么'}
          </Text>
          <Text style={styles.subtitle}>重复食材已经合并，点选家中已有的物品即可排除。</Text>
        </View>

        {hasPendingPlan ? (
          <InlineNotice icon="alert-circle-outline" tone="warning">
            当前菜单还没有确认采用。请先返回本周菜单确认，再创建购物清单。
          </InlineNotice>
        ) : null}

        <View style={styles.summaryRow}>
          <Text style={styles.summaryTitle}>{selectedCount} 项待购买</Text>
          <Text style={styles.summaryMeta}>{ownedIds.size} 项家中已有</Text>
        </View>

        {groupOrder.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <View key={group} style={styles.groupSection}>
              <Text style={styles.groupTitle}>{ingredientGroupLabels[group]}</Text>
              <View style={styles.itemList}>
                {groupItems.map((item) => {
                  const owned = ownedIds.has(item.id);
                  return (
                    <Pressable
                      accessibilityLabel={`${item.name}，${item.amount}，${owned ? '家中已有' : '需要购买'}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: owned }}
                      key={item.id}
                      onPress={() => toggleOwned(item.id)}
                      style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
                    >
                      <View style={[styles.checkbox, owned && styles.checkboxSelected]}>
                        {owned ? <AppIcon color={colors.background} name="checkmark" size={15} /> : null}
                      </View>
                      <View style={styles.itemCopy}>
                        <Text style={[styles.itemName, owned && styles.itemNameOwned]}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.itemSource}>
                          来自 {item.sources.slice(0, 2).join('、')}
                          {item.sources.length > 2 ? ` 等 ${item.sources.length} 道菜` : ''}
                        </Text>
                      </View>
                      <Text style={[styles.itemAmount, owned && styles.itemAmountOwned]}>{item.amount}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <RecipePrimaryButton
          disabled={hasPendingPlan || selectedCount <= 0}
          icon="checkmark-circle-outline"
          label={`确认创建 ${selectedCount} 项`}
          onPress={() => setCreated(true)}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 126,
  },
  intro: {
    paddingTop: 16,
    paddingBottom: 18,
  },
  title: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 25,
    lineHeight: 33,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  subtitle: {
    marginTop: 6,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  summaryRow: {
    minHeight: 58,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  summaryTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  summaryMeta: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  groupSection: {
    marginTop: 24,
  },
  groupTitle: {
    paddingBottom: 9,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  itemList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  itemRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  checkbox: {
    width: 23,
    height: 23,
    marginRight: 11,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: recipeColors.faint,
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  itemNameOwned: {
    color: recipeColors.faint,
    textDecorationLine: 'line-through',
  },
  itemSource: {
    marginTop: 3,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
  },
  itemAmount: {
    maxWidth: 128,
    marginLeft: 10,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  itemAmountOwned: {
    color: recipeColors.faint,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
    backgroundColor: recipeColors.background,
  },
  successState: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  successTitle: {
    marginTop: 20,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
  },
  successCopy: {
    marginTop: 8,
    marginBottom: 20,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
  },
  successButton: {
    width: '100%',
    marginTop: 10,
  },
  pressed: {
    opacity: 0.56,
  },
});
