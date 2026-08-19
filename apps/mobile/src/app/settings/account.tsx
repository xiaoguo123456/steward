import { errorMessage } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { useAccountActions, useCurrentUser } from '@/features/account/use-account';
import { colors, fontFamily, typography } from '@/theme/tokens';

/**
 * 账号与登录。
 *
 * 手机号由服务端脱敏后下发，客户端不做还原也不拼接完整号码。
 * 换绑手机、登录设备列表在契约里都还没有，所以这里不摆一个点不动的入口。
 */
export default function AccountScreen() {
  const router = useRouter();
  const { user, loading, failed, error, refetch } = useCurrentUser();
  const actions = useAccountActions();
  const [confirming, setConfirming] = useState(false);

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="账号与登录" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载账号信息。')}
            onAction={refetch}
            title="加载失败"
          />
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <SectionTitle title="登录方式" />
            <View style={styles.rows}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>手机号</Text>
                <Text style={styles.rowValue}>{user?.phone}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>时区</Text>
                <Text style={styles.rowValue}>{user?.timezone}</Text>
              </View>
            </View>

            <AppButton
              label="退出登录"
              onPress={() => setConfirming(true)}
              style={styles.signOut}
              variant="danger"
            />
          </>
        )}
      </ScrollView>

      {confirming ? (
        <Modal
          animationType="fade"
          onRequestClose={() => setConfirming(false)}
          statusBarTranslucent
          transparent
          visible
        >
          <ModalSheet onClose={() => setConfirming(false)}>
            <View style={styles.sheet}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                退出登录
              </Text>
              <Text style={styles.sheetCopy}>
                退出后需要重新用手机号登录。你的内容都在服务端，不会丢。
              </Text>
              <View style={styles.sheetActions}>
                <AppButton
                  disabled={actions.busy}
                  label={actions.busy ? '正在退出…' : '退出登录'}
                  onPress={async () => {
                    await actions.signOut();
                    // 退出后由根布局把用户送回登录页，这里只负责收起面板。
                    setConfirming(false);
                    router.replace('/');
                  }}
                  variant="danger"
                />
                <AppButton label="取消" onPress={() => setConfirming(false)} variant="text" />
              </View>
            </View>
          </ModalSheet>
        </Modal>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  rowValue: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  signOut: {
    marginTop: 32,
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  sheetTitle: {
    marginBottom: 12,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sheetCopy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  sheetActions: {
    marginTop: 18,
    gap: 8,
  },
});
