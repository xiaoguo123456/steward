import { useRouter } from 'expo-router';

import type { ShoppingCategory } from '@steward/api-client';

import {
  useShoppingList,
  type ShoppingDraft,
  type ShoppingListItem,
} from '@/features/shopping/use-shopping-list';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 展示模型来自数据层。品类是服务端算好的结果，
 * 客户端不再维护关键词表——同一件东西在两台设备上必须归到同一类。
 */
type ShoppingItem = ShoppingListItem;
type ShoppingItemDraft = ShoppingDraft;

type CategorySpec = {
  id: ShoppingCategory;
  label: string;
};

const categorySpecs: CategorySpec[] = [
  { id: 'produce', label: '蔬菜水果' },
  { id: 'protein', label: '肉蛋奶' },
  { id: 'staple', label: '主食调味' },
  { id: 'beverage', label: '饮品冲调' },
  { id: 'other', label: '其他' },
];

function ShoppingItemRow({
  item,
  checked,
  onToggle,
  onEdit,
}: {
  item: ShoppingItem;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const meta = [item.quantity, item.note, item.sourceTitle].filter(Boolean).join(' · ');

  return (
    <View style={styles.itemRow}>
      <Pressable
        accessibilityLabel={`${checked ? '移回待购买' : '标记已买到'}，${item.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={({ pressed }) => [styles.checkboxAction, pressed && styles.pressed]}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <AppIcon color={colors.background} name="checkmark" size={15} /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`编辑${item.title}，${meta}`}
        accessibilityRole="button"
        onPress={onEdit}
        style={({ pressed }) => [styles.itemContentAction, pressed && styles.pressed]}
      >
        <View style={styles.itemCopy}>
          <Text numberOfLines={1} style={[styles.itemTitle, checked && styles.itemTitleChecked]}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={[styles.itemMeta, checked && styles.itemMetaChecked]}>
            {meta}
          </Text>
        </View>
        {item.sourceTitle ? (
          <View style={styles.recipeTag}>
            <Text style={styles.recipeTagText}>食谱</Text>
          </View>
        ) : null}
        <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
      </Pressable>
    </View>
  );
}

function CategoryGroup({
  label,
  items,
  onToggle,
  onEdit,
}: {
  label: string;
  items: ShoppingItem[];
  onToggle: (itemId: string) => void;
  onEdit: (itemId: string) => void;
}) {
  return (
    <View style={styles.categoryGroup}>
      <View style={styles.categoryHeader}>
        <Text accessibilityRole="header" style={styles.categoryTitle}>{label}</Text>
        <Text style={styles.categoryCount}>{items.length} 项</Text>
      </View>
      <View style={styles.itemList}>
        {items.map((item) => (
          <ShoppingItemRow
            checked={false}
            item={item}
            key={item.id}
            onEdit={() => onEdit(item.id)}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </View>
    </View>
  );
}

function ShoppingItemSheet({
  visible,
  item,
  onClose,
  onSave,
}: {
  visible: boolean;
  item?: ShoppingItem;
  onClose: () => void;
  onSave: (draft: ShoppingItemDraft) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [quantity, setQuantity] = useState(item?.quantity ?? '1');
  const [note, setNote] = useState(item?.note ?? '');

  const canSave = Boolean(title.trim()) && Boolean(quantity.trim());

  const save = () => {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      quantity: quantity.trim(),
      note: note.trim() || undefined,
    });
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <ModalSheet maxHeight="72%" onClose={onClose}>
        <View style={styles.sheetLayout}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.sheetScroll}
          >
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                {item ? '编辑商品' : '新增商品'}
              </Text>
              <Pressable
                accessibilityLabel="关闭商品编辑"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <AppIcon color={colors.text} name="close" size={22} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>商品名称</Text>
            <TextInput
              accessibilityLabel="商品名称"
              maxLength={30}
              onChangeText={setTitle}
              placeholder="例如：苹果"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
              selectionColor={colors.primary}
              style={styles.textInput}
              value={title}
            />

            <Text style={styles.fieldLabel}>数量／规格</Text>
            <TextInput
              accessibilityLabel="商品数量或规格"
              maxLength={20}
              onChangeText={setQuantity}
              placeholder="例如：2 盒、500 克"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
              selectionColor={colors.primary}
              style={styles.textInput}
              value={quantity}
            />

            <View style={styles.optionalLabelRow}>
              <Text style={styles.fieldLabel}>备注</Text>
              <Text style={styles.optionalLabel}>选填</Text>
            </View>
            <TextInput
              accessibilityLabel="商品备注"
              maxLength={40}
              onChangeText={setNote}
              placeholder="品牌、规格或口味"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              selectionColor={colors.primary}
              style={styles.textInput}
              value={note}
            />
          </ScrollView>

          <View style={styles.sheetFooter}>
            <AppButton
              disabled={!canSave}
              icon={item ? 'checkmark' : 'add'}
              label={item ? '保存修改' : '加入购物清单'}
              onPress={save}
            />
          </View>
        </View>
      </ModalSheet>
    </Modal>
  );
}

export function ShoppingContent({
  createVisible,
  onCreateVisibleChange,
}: {
  createVisible: boolean;
  onCreateVisibleChange: (visible: boolean) => void;
}) {
  const router = useRouter();
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const shopping = useShoppingList();
  const items = shopping.items;

  const remainingItems = useMemo(
    () => items.filter((item) => !item.done),
    [items],
  );
  const completedItems = useMemo(
    () => items.filter((item) => item.done),
    [items],
  );
  const groupedItems = useMemo(
    () =>
      categorySpecs
        .map((category) => ({
          ...category,
          items: remainingItems.filter((item) => item.category === category.id),
        }))
        .filter((category) => category.items.length > 0),
    [remainingItems],
  );
  const editingItem = items.find((item) => item.id === editingItemId);

  const totalCount = items.length;
  const completedCount = completedItems.length;
  const progress = totalCount === 0 ? 0 : completedCount / totalCount;
  const progressWidth = `${Math.round(progress * 100)}%` as `${number}%`;

  const toggleItem = (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    if (!item.done) setCompletedExpanded(true);
    setFailure(null);
    shopping.toggle(item);
  };

  const closeSheet = () => {
    setEditingItemId(null);
    onCreateVisibleChange(false);
  };

  const saveItem = (draft: ShoppingItemDraft) => {
    setFailure(null);
    // 品类由服务端算，这里不传：同一件东西在两台设备上必须归到同一类。
    if (editingItem) {
      shopping.update(editingItem, draft);
    } else {
      shopping.create(draft);
    }
    closeSheet();
  };

  return (
    <>
      <View style={styles.listStatus}>
        <View style={styles.statusCopy}>
          <Text accessibilityRole="header" style={styles.statusTitle}>
            {remainingItems.length > 0 ? `待购买 ${remainingItems.length} 项` : '已全部买齐'}
          </Text>
          <Text style={styles.statusMeta}>已完成 {completedCount} / {totalCount}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/features/recipes')}
          style={({ pressed }) => [styles.recipeAction, pressed && styles.pressed]}
        >
          <AppIcon color={colors.primaryStrong} name="restaurant-outline" size={17} />
          <Text style={styles.recipeActionText}>从食谱添加</Text>
        </Pressable>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: progressWidth }]} />
      </View>

      {failure ? <Text style={styles.failureText}>{failure}</Text> : null}

      {groupedItems.length > 0 ? (
        <View style={styles.groups}>
          {groupedItems.map((group) => (
            <CategoryGroup
              items={group.items}
              key={group.id}
              label={group.label}
              onEdit={setEditingItemId}
              onToggle={toggleItem}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <AppIcon color={colors.primaryStrong} name="checkmark-circle-outline" size={28} />
          <Text style={styles.emptyTitle}>清单已完成</Text>
        </View>
      )}

      {completedItems.length > 0 ? (
        <View style={styles.completedSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: completedExpanded }}
            onPress={() => setCompletedExpanded((current) => !current)}
            style={({ pressed }) => [styles.completedHeader, pressed && styles.pressed]}
          >
            <View style={styles.completedHeaderCopy}>
              <Text style={styles.completedTitle}>已买到</Text>
              <Text style={styles.completedCount}>{completedItems.length} 项</Text>
            </View>
            <AppIcon
              color={colors.textSecondary}
              name={completedExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
            />
          </Pressable>
          {completedExpanded ? (
            <View style={styles.itemList}>
              {completedItems.map((item) => (
                <ShoppingItemRow
                  checked
                  item={item}
                  key={item.id}
                  onEdit={() => setEditingItemId(item.id)}
                  onToggle={() => toggleItem(item.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {createVisible || editingItem ? (
        <ShoppingItemSheet
          item={editingItem}
          key={editingItem?.id ?? 'new-shopping-item'}
          onClose={closeSheet}
          onSave={saveItem}
          visible
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.65,
  },
  failureText: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  listStatus: {
    minHeight: 72,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
  },
  statusTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  statusMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontVariant: ['tabular-nums'],
  },
  recipeAction: {
    minHeight: 44,
    marginLeft: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.sm,
  },
  recipeActionText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTrack,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  groups: {
    marginTop: 12,
    gap: 14,
  },
  categoryGroup: {
    gap: 7,
  },
  categoryHeader: {
    minHeight: 34,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  categoryCount: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  itemList: {
    gap: 7,
  },
  itemRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  checkboxAction: {
    width: 52,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  checkboxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  itemContentAction: {
    minWidth: 0,
    minHeight: 64,
    flex: 1,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  itemTitleChecked: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  itemMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  itemMetaChecked: {
    color: colors.textTertiary,
  },
  recipeTag: {
    minWidth: 38,
    minHeight: 24,
    marginLeft: 8,
    marginRight: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: '#FFF1E7',
  },
  recipeTagText: {
    color: '#A44F1C',
    fontFamily,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  emptyState: {
    minHeight: 132,
    marginTop: 22,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  emptyTitle: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.bodyStrong,
  },
  completedSection: {
    marginTop: 18,
  },
  completedHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  completedHeaderCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  completedTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  completedCount: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontVariant: ['tabular-nums'],
  },
  sheetLayout: {
    flexShrink: 1,
  },
  sheetScroll: {
    flexShrink: 1,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
  },
  sheetHeader: {
    minHeight: 48,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sheetTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    marginTop: -7,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  fieldLabel: {
    marginTop: 16,
    marginBottom: 8,
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  textInput: {
    minHeight: 52,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily,
    ...typography.input,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  optionalLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionalLabel: {
    marginTop: 16,
    marginBottom: 8,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 11,
    lineHeight: 19,
  },
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: colors.background,
  },
});
