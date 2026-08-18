import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { LedgerContent } from '@/features/ledger/ledger-content';
import { colors, fontFamily, radius } from '@/theme/tokens';

type FeatureSlug =
  | 'recipes'
  | 'ledger'
  | 'important-dates'
  | 'shopping'
  | 'review'
  | 'more';

type FeatureMeta = {
  title: string;
  summary: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  color: string;
  soft: string;
};

type CheckItem = {
  id: string;
  title: string;
  meta: string;
};

const featureMeta: Record<FeatureSlug, FeatureMeta> = {
  recipes: {
    title: '食谱',
    summary: '从今天吃什么开始，选好菜单后可以直接生成购物清单。',
    icon: 'restaurant-outline',
    color: '#D56C28',
    soft: '#FFF1E7',
  },
  ledger: {
    title: '记账',
    summary: '快速记下一笔收入或支出，后续可用图片识别票据信息。',
    icon: 'wallet-outline',
    color: '#3978B8',
    soft: '#EAF4FF',
  },
  'important-dates': {
    title: '重要日',
    summary: '集中管理生日、纪念日和证件到期日，并在日历中统一提醒。',
    icon: 'gift-outline',
    color: '#C04C81',
    soft: '#FDEEF5',
  },
  shopping: {
    title: '购物',
    summary: '把临时想到的物品和食谱食材放进同一张可勾选清单。',
    icon: 'cart-outline',
    color: '#7657C8',
    soft: '#F2EEFF',
  },
  review: {
    title: '复盘',
    summary: '汇总任务、打卡与专注情况，建议只在你确认后进入计划。',
    icon: 'refresh-outline',
    color: '#187A75',
    soft: '#E9F7F5',
  },
  more: {
    title: '更多',
    summary: '按自己的生活方式扩展打卡、提醒和清单能力。',
    icon: 'grid-outline',
    color: '#68716D',
    soft: '#EEF1F0',
  },
};

const recipes = [
  { id: 'pasta', title: '番茄牛肉意面', meta: '30 分钟 · 约 620 千卡' },
  { id: 'salad', title: '鸡胸肉藜麦沙拉', meta: '25 分钟 · 高蛋白' },
  { id: 'rice', title: '菌菇鸡肉焖饭', meta: '40 分钟 · 一锅完成' },
];

const importantDates = [
  { id: 'mother', title: '妈妈生日', date: '6月24日', countdown: '还有 6 天' },
  { id: 'anniversary', title: '纪念日', date: '7月12日', countdown: '还有 24 天' },
  { id: 'passport', title: '护照到期', date: '2027年3月8日', countdown: '建议提前办理' },
];

const initialShoppingItems: CheckItem[] = [
  { id: 'tomato', title: '番茄', meta: '4 个 · 来自番茄牛肉意面' },
  { id: 'beef', title: '牛肉末', meta: '300 克 · 来自番茄牛肉意面' },
  { id: 'milk', title: '牛奶', meta: '1 盒 · 手动添加' },
  { id: 'coffee', title: '咖啡豆', meta: '1 袋 · 手动添加' },
];

function isFeatureSlug(value: string): value is FeatureSlug {
  return value in featureMeta;
}

function SectionTitle({ title, aside }: { title: string; aside?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {aside ? <Text style={styles.sectionAside}>{aside}</Text> : null}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.primaryButtonPressed,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function CheckRow({
  item,
  checked,
  onToggle,
}: {
  item: CheckItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${checked ? '取消完成' : '完成'}${item.title}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={({ pressed }) => [styles.checkRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.checkCircle, checked && styles.checkCircleDone]}>
        {checked ? <AppIcon color={colors.background} name="checkmark" size={15} /> : null}
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, checked && styles.rowTitleDone]}>{item.title}</Text>
        <Text style={styles.rowMeta}>{item.meta}</Text>
      </View>
    </Pressable>
  );
}

function LinkRow({
  title,
  meta,
  icon,
  color,
  soft,
  onPress,
}: {
  title: string;
  meta: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  color: string;
  soft: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${title}，${meta}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.linkIcon, { backgroundColor: soft }]}>
        <AppIcon color={color} name={icon} size={19} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowMeta}>{meta}</Text>
      </View>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function RecipesContent() {
  const router = useRouter();
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId);

  return (
    <>
      <SectionTitle aside="3 个推荐" title="今天吃什么" />
      <View style={styles.rows}>
        {recipes.map((recipe) => {
          const selected = selectedRecipeId === recipe.id;
          return (
            <Pressable
              accessibilityLabel={`${selected ? '取消选择' : '选择'}${recipe.title}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={recipe.id}
              onPress={() => setSelectedRecipeId(selected ? null : recipe.id)}
              style={({ pressed }) => [styles.choiceRow, pressed && styles.rowPressed]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{recipe.title}</Text>
                <Text style={styles.rowMeta}>{recipe.meta}</Text>
              </View>
              <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {selectedRecipe ? (
        <View style={styles.selectionPanel}>
          <Text style={styles.selectionTitle}>已加入今日菜单</Text>
          <Text style={styles.selectionCopy}>{selectedRecipe.title} · 晚餐</Text>
          <PrimaryButton
            label="生成购物清单"
            onPress={() =>
              router.push({ pathname: '/features/[slug]', params: { slug: 'shopping' } })
            }
          />
        </View>
      ) : (
        <Text style={styles.emptyHint}>选择一道菜后，可以把缺少的食材加入购物清单。</Text>
      )}
    </>
  );
}

function ImportantDatesContent() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(importantDates[0].id);
  const selectedDate = importantDates.find((item) => item.id === selectedId) ?? importantDates[0];

  return (
    <>
      <SectionTitle aside="最近 3 个" title="即将到来" />
      <View style={styles.rows}>
        {importantDates.map((item) => {
          const selected = selectedId === item.id;
          return (
            <Pressable
              accessibilityLabel={`${item.title}，${item.date}，${item.countdown}`}
              accessibilityRole="button"
              key={item.id}
              onPress={() => setSelectedId(item.id)}
              style={({ pressed }) => [
                styles.importantRow,
                selected && styles.importantRowSelected,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowMeta}>{item.date}</Text>
              </View>
              <Text style={styles.countdown}>{item.countdown}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.selectionPanel}>
        <Text style={styles.selectionTitle}>{selectedDate.title}</Text>
        <Text style={styles.selectionCopy}>
          {selectedDate.date} · 已开启提前 7 天和当天提醒
        </Text>
        <PrimaryButton label="在日历中查看" onPress={() => router.push('/calendar')} />
      </View>
    </>
  );
}

function ShoppingContent() {
  const router = useRouter();
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const remainingCount = initialShoppingItems.length - doneIds.size;

  const toggleItem = (itemId: string) => {
    setDoneIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  return (
    <>
      <SectionTitle aside={`${remainingCount} 项待购买`} title="购物清单" />
      <View style={styles.rows}>
        {initialShoppingItems.map((item) => (
          <CheckRow
            checked={doneIds.has(item.id)}
            item={item}
            key={item.id}
            onToggle={() => toggleItem(item.id)}
          />
        ))}
      </View>
      <View style={styles.actionBlock}>
        <PrimaryButton
          label="从食谱添加食材"
          onPress={() => router.push('/features/recipes')}
        />
        <Text style={styles.actionHint}>也可以通过底部“新增”用语音或图片补充物品。</Text>
      </View>
    </>
  );
}

function ReviewContent() {
  const router = useRouter();

  return (
    <>
      <SectionTitle aside="更新于 17:10" title="今日概览" />
      <View style={styles.reviewMetrics}>
        <View style={styles.reviewMetric}>
          <Text style={styles.metricValue}>3/5</Text>
          <Text style={styles.metricLabel}>任务完成</Text>
        </View>
        <View style={styles.reviewMetricDivider} />
        <View style={styles.reviewMetric}>
          <Text style={styles.metricValue}>2/3</Text>
          <Text style={styles.metricLabel}>今日打卡</Text>
        </View>
        <View style={styles.reviewMetricDivider} />
        <View style={styles.reviewMetric}>
          <Text style={styles.metricValue}>4</Text>
          <Text style={styles.metricLabel}>完成番茄</Text>
        </View>
      </View>

      <SectionTitle title="建议关注" />
      <View style={styles.reviewSuggestion}>
        <View style={styles.suggestionIcon}>
          <AppIcon color={colors.primaryStrong} name="sparkles" size={18} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>把“购买出差机票”安排到明天上午</Text>
          <Text style={styles.rowMeta}>当前只是建议，确认后才会修改任务日期。</Text>
        </View>
      </View>

      <View style={styles.linkRows}>
        <LinkRow
          color={colors.primaryStrong}
          icon="checkbox-outline"
          meta="查看未完成任务和明日安排"
          onPress={() => router.push('/lists')}
          soft={colors.primarySoft}
          title="查看计划"
        />
        <LinkRow
          color="#3978B8"
          icon="checkmark-circle-outline"
          meta="补齐今天尚未完成的记录"
          onPress={() => router.push('/data')}
          soft="#EAF4FF"
          title="查看打卡"
        />
      </View>
    </>
  );
}

const moreTools: {
  title: string;
  meta: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  color: string;
  soft: string;
  href: Href;
}[] = [
  {
    title: '喝水打卡',
    meta: '设置每日目标并查看连续记录',
    icon: 'water-outline',
    color: '#3978B8',
    soft: '#EAF4FF',
    href: '/data',
  },
  {
    title: '睡眠记录',
    meta: '记录时长和入睡感受',
    icon: 'moon-outline',
    color: '#6D5B95',
    soft: '#F0EDF7',
    href: '/data',
  },
  {
    title: '阅读打卡',
    meta: '记录阅读时长和当前书目',
    icon: 'book-outline',
    color: '#D56C28',
    soft: '#FFF1E7',
    href: '/data',
  },
  {
    title: '家庭事务',
    meta: '整理家务、采购和家庭提醒',
    icon: 'home-outline',
    color: colors.primaryStrong,
    soft: colors.primarySoft,
    href: '/lists',
  },
];

function MoreContent() {
  const router = useRouter();

  return (
    <>
      <SectionTitle aside="按需使用" title="更多功能" />
      <View style={styles.linkRows}>
        {moreTools.map((tool) => (
          <LinkRow
            color={tool.color}
            icon={tool.icon}
            key={tool.title}
            meta={tool.meta}
            onPress={() => router.push(tool.href)}
            soft={tool.soft}
            title={tool.title}
          />
        ))}
      </View>
      <Text style={styles.emptyHint}>后续可在这里调整首页入口，但系统不会自动打乱你熟悉的位置。</Text>
    </>
  );
}

function FeatureContent({ slug }: { slug: FeatureSlug }) {
  if (slug === 'recipes') return <RecipesContent />;
  if (slug === 'ledger') return <LedgerContent />;
  if (slug === 'important-dates') return <ImportantDatesContent />;
  if (slug === 'shopping') return <ShoppingContent />;
  if (slug === 'review') return <ReviewContent />;
  return <MoreContent />;
}

export default function ShortcutFeatureScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const rawSlug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const slug: FeatureSlug = rawSlug && isFeatureSlug(rawSlug) ? rawSlug : 'more';
  const meta = featureMeta[slug];

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={meta.title} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {slug !== 'review' && slug !== 'ledger' ? (
          <View style={[styles.intro, { backgroundColor: meta.soft }]}>
            <View style={[styles.introIcon, { backgroundColor: colors.background }]}>
              <AppIcon color={meta.color} name={meta.icon} size={23} />
            </View>
            <Text style={[styles.introText, { color: meta.color }]}>{meta.summary}</Text>
          </View>
        ) : null}
        <FeatureContent slug={slug} />
      </ScrollView>
      <AiFab />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  intro: {
    minHeight: 76,
    marginTop: 6,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
  },
  introIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introText: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  sectionHeading: {
    minHeight: 52,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  sectionAside: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  checkRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkCircle: {
    width: 24,
    height: 24,
    marginRight: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  checkCircleDone: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  rowTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  rowMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  rowPressed: {
    opacity: 0.56,
  },
  actionBlock: {
    marginTop: 20,
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonPressed: {
    opacity: 0.82,
  },
  primaryButtonDisabled: {
    backgroundColor: '#B9C4BF',
  },
  primaryButtonText: {
    color: colors.background,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  actionHint: {
    marginTop: 9,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  choiceRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  radioCircle: {
    width: 22,
    height: 22,
    marginLeft: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  selectionPanel: {
    marginTop: 18,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  selectionTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  selectionCopy: {
    marginTop: 4,
    marginBottom: 14,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyHint: {
    marginTop: 18,
    paddingHorizontal: 12,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  importantRow: {
    minHeight: 66,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  importantRowSelected: {
    backgroundColor: '#FDF5F8',
  },
  countdown: {
    marginLeft: 12,
    color: '#A53E70',
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  reviewMetrics: {
    height: 78,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  reviewMetric: {
    flex: 1,
    alignItems: 'center',
  },
  reviewMetricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 30,
    backgroundColor: colors.border,
  },
  metricValue: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 10,
    lineHeight: 14,
  },
  reviewSuggestion: {
    minHeight: 82,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  suggestionIcon: {
    width: 34,
    height: 34,
    marginRight: 11,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTrack,
  },
  linkRows: {
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  linkRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  linkIcon: {
    width: 36,
    height: 36,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
