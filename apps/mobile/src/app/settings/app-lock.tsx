import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { NavHeader } from '@/components/ui/nav-header';
import { useAppLock } from '@/features/app-lock/app-lock-provider';
import { colors, fontFamily, spacing, typography } from '@/theme/tokens';

export default function AppLockSettingsScreen() {
  const router = useRouter();
  const appLock = useAppLock();
  const supported = appLock.availability === 'available';

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="应用锁" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.summary}>
          开启后，每次重新打开 App 或从后台回来，都要先通过设备身份验证。系统任务切换预览也会隐藏内容。
        </Text>

        {!appLock.ready ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primaryStrong} />
            <Text style={styles.loadingText}>正在检查设备保护能力…</Text>
          </View>
        ) : (
          <FlatListGroup>
            <FlatListRow
              icon="lock-closed-outline"
              showChevron={false}
              showDivider={false}
              subtitle={
                supported
                  ? `使用${appLock.authenticationLabel}`
                  : availabilityMessage(appLock.availability)
              }
              title="解锁后查看内容"
              trailing={
                <Switch
                  accessibilityLabel="应用锁开关"
                  accessibilityState={{ disabled: !supported || appLock.busy }}
                  disabled={!supported || appLock.busy}
                  onValueChange={(enabled) => {
                    void (enabled ? appLock.enable() : appLock.disable());
                  }}
                  thumbColor={colors.background}
                  trackColor={{ false: colors.borderStrong, true: colors.primary }}
                  value={appLock.enabled}
                />
              }
            />
          </FlatListGroup>
        )}

        {appLock.failure ? <Text accessibilityRole="alert" style={styles.failure}>{appLock.failure}</Text> : null}

        <View style={styles.notes}>
          <Text style={styles.noteTitle}>保护范围</Text>
          <Text style={styles.note}>
            锁定时会遮住任务、日记、草稿和其他账号内容。验证由 iOS 或 Android 完成，App 不读取、保存或上传你的面容与指纹信息。
          </Text>
          <Text style={styles.note}>
            应用锁只保护这台设备上的页面，不能替代登录、服务端权限和设备系统锁。
          </Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

function availabilityMessage(availability: 'checking' | 'available' | 'not-enrolled' | 'unsupported') {
  if (availability === 'not-enrolled') return '请先在系统设置中录入面容、指纹或设备密码';
  return '当前设备或 Web 版本不支持应用锁';
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  summary: { marginBottom: spacing.lg, color: colors.textSecondary, fontFamily, ...typography.body },
  loading: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  failure: { marginTop: spacing.md, color: colors.danger, fontFamily, ...typography.meta },
  notes: { marginTop: spacing.xl, gap: spacing.sm },
  noteTitle: { color: colors.text, fontFamily, ...typography.section },
  note: { color: colors.textSecondary, fontFamily, ...typography.meta },
});
