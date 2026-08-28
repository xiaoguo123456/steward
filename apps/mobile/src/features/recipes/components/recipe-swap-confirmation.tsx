import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, spacing, typography } from '@/theme/tokens';

import { useRecipePrototype } from '../recipe-context';
import { mealSlotLabels } from '../model';

/**
 * 单道替换确认。
 *
 * 确认后直接保存整周菜单；这是服务端的原子写入边界。用户不需要再去页底寻找
 * 第二个确认按钮，失败时弹窗保持打开并允许原地重试。
 */
export function RecipeSwapConfirmation() {
  const {
    cancelSwap,
    confirmSwap,
    days,
    pendingSwap,
    planFailure,
    swapSaving,
  } = useRecipePrototype();

  if (!pendingSwap) return null;
  const day = days.find((item) => item.id === pendingSwap.dayId);
  const next = pendingSwap.nextRecipe;
  const close = () => {
    if (!swapSaving) cancelSwap();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible
    >
      <ModalSheet minHeight={0} onClose={close}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {pendingSwap.loading ? '正在找同类菜' : next ? '换成这道菜？' : '暂时没有同类菜可换'}
          </Text>

          {pendingSwap.loading ? (
            <View accessibilityLabel="正在寻找替换菜谱" accessibilityRole="progressbar" style={styles.loading}>
              <ActivityIndicator color={colors.primaryStrong} size="small" />
              <Text style={styles.copy}>正在按餐次、菜品角色和饮食档案筛选。</Text>
            </View>
          ) : next ? (
            <>
              <Text style={styles.context}>
                {day?.fullDate ?? pendingSwap.dayId} · {mealSlotLabels[pendingSwap.meal]}
              </Text>
              <View style={styles.comparison}>
                <View style={styles.recipeRow}>
                  <Text style={styles.rowLabel}>原来</Text>
                  <Text numberOfLines={2} style={styles.recipeTitle}>
                    {pendingSwap.currentRecipe.title}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.recipeRow}>
                  <Text style={styles.rowLabel}>换成</Text>
                  <View style={styles.nextCopy}>
                    <Text numberOfLines={2} style={styles.nextTitle}>
                      {next.title}
                    </Text>
                    <Text style={styles.meta}>
                      {next.timeMinutes} 分钟 · {Math.round(next.calories)} 千卡
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={styles.copy}>确认后立即保存本周菜单，不需要再到页底确认。</Text>
              {planFailure ? <Text style={styles.failure}>{planFailure}</Text> : null}
              <View style={styles.actions}>
                <AppButton
                  disabled={swapSaving}
                  label={swapSaving ? '正在更换…' : '确认更换'}
                  onPress={() => void confirmSwap()}
                />
                <AppButton
                  disabled={swapSaving}
                  label="取消"
                  onPress={cancelSwap}
                  variant="text"
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.copy}>
                {pendingSwap.failure
                  ?? '为了不打乱这一餐的主食、荤菜或素菜结构，只会推荐同餐次、同角色的菜。'}
              </Text>
              <View style={styles.actions}>
                <AppButton label="知道了" onPress={cancelSwap} variant="secondary" />
              </View>
            </>
          )}
        </View>
      </ModalSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  context: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  comparison: {
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recipeRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLabel: {
    width: 42,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  recipeTitle: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  nextCopy: {
    flex: 1,
    gap: 2,
  },
  nextTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  meta: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
    backgroundColor: colors.border,
  },
  copy: {
    marginTop: spacing.lg,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  failure: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  loading: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
