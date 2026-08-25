import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  InlineNotice,
  RecipePrimaryButton,
} from '@/features/recipes/components/recipe-ui';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { useShoppingDraft } from '@/features/recipes/use-shopping-draft';
import { recipeColors } from '@/features/recipes/theme';
import { useClientReady } from '@/hooks/use-client-ready';
import {
  ingredientGroupLabels,
  type IngredientGroup,
  type Recipe,
} from '@/features/recipes/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

const groupOrder: IngredientGroup[] = ['produce', 'protein', 'staple', 'seasoning'];

export default function RecipeShoppingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scope?: string }>();
  const clientReady = useClientReady();
  const scope = clientReady && params.scope === 'week' ? 'week' : 'day';
  const { weekStart, selectedDayId, hasPendingPlan, getRecipe } = useRecipePrototype();
  // 默认全部加入购物清单；用户取消勾选的项目才会在创建时排除。
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const draft = useShoppingDraft({
    weekStart,
    date: scope === 'week' ? undefined : selectedDayId,
  });
  const items = draft.items;
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const selectedCount = items.filter((item) => !excludedIds.has(item.id)).length;

  const submit = async () => {
    const count = selectedCount;
    if (await draft.create(excludedIds)) setCreatedCount(count);
  };

  const toggleSelected = (itemId: string) => {
    setExcludedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  if (createdCount !== null) {
    return (
      <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
        <NavHeader title="购物清单" />
        <View style={styles.successState}>
          <View style={styles.successIcon}>
            <AppIcon color={colors.background} name="checkmark" size={34} />
          </View>
          <Text accessibilityRole="header" style={styles.successTitle}>购物清单已创建</Text>
          <Text style={styles.successCopy}>
            已创建 {createdCount} 项待购买，可前往购物清单继续调整。
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
        </View>

        {hasPendingPlan ? (
          <InlineNotice icon="alert-circle-outline" tone="warning">
            当前菜单还没有确认采用。请先返回本周菜单确认，再创建购物清单。
          </InlineNotice>
        ) : null}

        <View style={styles.summaryRow}>
          <Text style={styles.summaryTitle}>{selectedCount} 项待购买</Text>
          <Text style={styles.summaryMeta}>{excludedIds.size} 项已排除</Text>
        </View>

        {groupOrder.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <View key={group} style={styles.groupSection}>
              <Text style={styles.groupTitle}>{ingredientGroupLabels[group]}</Text>
              <View style={styles.itemList}>
                {groupItems.map((item) => {
                  const selected = !excludedIds.has(item.id);
                  return (
                    <Pressable
                      accessibilityLabel={`${item.name}，${item.amount}，${selected ? '已选择购买' : '已排除'}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      key={item.id}
                      onPress={() => toggleSelected(item.id)}
                      style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
                    >
                      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected ? <AppIcon color={colors.background} name="checkmark" size={15} /> : null}
                      </View>
                      <View style={styles.itemCopy}>
                        <Text style={[styles.itemName, !selected && styles.itemNameExcluded]}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.itemSource}>
                          {describeSources(item.recipeIds, getRecipe)}
                        </Text>
                      </View>
                      <Text style={[styles.itemAmount, !selected && styles.itemAmountExcluded]}>{item.amount}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        {draft.failure ? <Text style={styles.failure}>{draft.failure}</Text> : null}
        <RecipePrimaryButton
          disabled={hasPendingPlan || selectedCount <= 0 || draft.creating}
          icon="checkmark-circle-outline"
          label={draft.creating ? '正在创建…' : `确认创建 ${selectedCount} 项`}
          onPress={() => void submit()}
        />
      </View>
    </AppScreen>
  );
}

/** 「来自 番茄炒蛋、菌菇汤」。查不到名字的菜谱不显示，不摆一个 ID 给用户看。 */
function describeSources(
  recipeIds: string[],
  getRecipe: (recipeId: string) => Recipe | undefined,
): string {
  const titles = recipeIds
    .map((id) => getRecipe(id)?.title)
    .filter((title): title is string => Boolean(title));
  if (titles.length === 0) return '';
  const shown = titles.slice(0, 2).join('、');
  return titles.length > 2 ? `来自 ${shown} 等 ${titles.length} 道菜` : `来自 ${shown}`;
}

const styles = StyleSheet.create({
  failure: {
    marginBottom: 8,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
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
  itemNameExcluded: {
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
  itemAmountExcluded: {
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
