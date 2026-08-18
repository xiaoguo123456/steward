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
import { ImportantDatesContent } from '@/features/important-dates/important-dates-content';
import { LedgerContent } from '@/features/ledger/ledger-content';
import { ReviewContent } from '@/features/review/review-content';
import { ShoppingContent } from '@/features/shopping/shopping-content';
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

const moreTools: {
  title: string;
  meta: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  color: string;
  soft: string;
  href: Href;
}[] = [
  {
    title: '行程',
    meta: '集中查看按天安排、预订信息和行前清单',
    icon: 'airplane-outline',
    color: '#187A75',
    soft: '#E9F7F5',
    href: '/trips',
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
    </>
  );
}

function FeatureContent({
  slug,
  importantDateCreateVisible,
  onImportantDateCreateVisibleChange,
  shoppingCreateVisible,
  onShoppingCreateVisibleChange,
}: {
  slug: FeatureSlug;
  importantDateCreateVisible: boolean;
  onImportantDateCreateVisibleChange: (visible: boolean) => void;
  shoppingCreateVisible: boolean;
  onShoppingCreateVisibleChange: (visible: boolean) => void;
}) {
  if (slug === 'recipes') return <RecipesContent />;
  if (slug === 'ledger') return <LedgerContent />;
  if (slug === 'important-dates') {
    return (
      <ImportantDatesContent
        createVisible={importantDateCreateVisible}
        onCreateVisibleChange={onImportantDateCreateVisibleChange}
      />
    );
  }
  if (slug === 'shopping') {
    return (
      <ShoppingContent
        createVisible={shoppingCreateVisible}
        onCreateVisibleChange={onShoppingCreateVisibleChange}
      />
    );
  }
  if (slug === 'review') return <ReviewContent />;
  return <MoreContent />;
}

export default function ShortcutFeatureScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const rawSlug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const slug: FeatureSlug = rawSlug && isFeatureSlug(rawSlug) ? rawSlug : 'more';
  const meta = featureMeta[slug];
  const [importantDateCreateVisible, setImportantDateCreateVisible] = useState(false);
  const [shoppingCreateVisible, setShoppingCreateVisible] = useState(false);

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={
          slug === 'important-dates' || slug === 'shopping' ? (
            <Pressable
              accessibilityLabel={slug === 'important-dates' ? '新增重要日' : '新增商品'}
              accessibilityRole="button"
              onPress={() => {
                if (slug === 'important-dates') {
                  setImportantDateCreateVisible(true);
                } else {
                  setShoppingCreateVisible(true);
                }
              }}
              style={({ pressed }) => [
                styles.headerAction,
                pressed && styles.headerActionPressed,
              ]}
            >
              <AppIcon color={colors.primaryStrong} name="add" size={24} />
            </Pressable>
          ) : null
        }
        title={meta.title}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {slug !== 'more' &&
        slug !== 'review' &&
        slug !== 'ledger' &&
        slug !== 'important-dates' &&
        slug !== 'shopping' ? (
          <View style={[styles.intro, { backgroundColor: meta.soft }]}>
            <View style={[styles.introIcon, { backgroundColor: colors.background }]}>
              <AppIcon color={meta.color} name={meta.icon} size={23} />
            </View>
            <Text style={[styles.introText, { color: meta.color }]}>{meta.summary}</Text>
          </View>
        ) : null}
        <FeatureContent
          importantDateCreateVisible={importantDateCreateVisible}
          onImportantDateCreateVisibleChange={setImportantDateCreateVisible}
          onShoppingCreateVisibleChange={setShoppingCreateVisible}
          shoppingCreateVisible={shoppingCreateVisible}
          slug={slug}
        />
      </ScrollView>
      {slug !== 'review' ? <AiFab /> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  headerActionPressed: {
    backgroundColor: colors.primarySoft,
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
