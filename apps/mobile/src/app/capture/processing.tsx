import { errorMessage, useGetOperation } from '@steward/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 处理进度页。
 *
 * 服务端返回 202 与 operation_id 后，这里轮询 Operation 直到完成。
 * 进度是真实的服务端状态，不是本地定时器编出来的动画。
 */
export default function CaptureProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    captureId?: string;
    operationId?: string;
    draft?: string;
    intent?: string;
  }>();

  const operationId = params.operationId ?? '';
  const captureId = params.captureId ?? '';

  const operation = useGetOperation(operationId, {
    query: {
      enabled: Boolean(operationId),
      // 解析通常在一秒内完成；完成后立即停止轮询。
      refetchInterval: (query) => {
        const status = query.state.data?.data.status;
        return status === 'succeeded' || status === 'failed' || status === 'cancelled'
          ? false
          : 800;
      },
    },
  });

  const status = operation.data?.data.status;

  useEffect(() => {
    if (status === 'succeeded' && captureId) {
      router.replace({
        pathname: '/capture/confirm',
        params: { captureId, intent: params.intent },
      });
    }
  }, [status, captureId, params.intent, router]);

  const failed = status === 'failed' || operation.isError;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="正在整理" />
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          {failed ? (
            <AppIcon color={colors.danger} name="alert-circle-outline" size={34} />
          ) : (
            <ActivityIndicator color={colors.primary} size="large" />
          )}
        </View>

        <Text style={styles.title}>{failed ? '这次没能整理成功' : 'AI 正在理解你的输入'}</Text>
        <Text style={styles.copy}>
          {failed
            ? errorMessage(
                operation.data?.data.error ?? operation.error,
                '你仍然可以返回修改输入，或直接手动填写。',
              )
            : '整理完成后会展示可编辑的结果，确认后才会保存。'}
        </Text>

        {params.draft ? (
          <View style={styles.draftBox}>
            <Text numberOfLines={3} style={styles.draftText}>
              {params.draft}
            </Text>
          </View>
        ) : null}

        {failed ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace({
                pathname: '/capture/new',
                params: { intent: params.intent },
              })}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>重新输入</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => params.intent === 'trip'
                ? router.replace('/trips/new')
                : router.replace('/today')}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>稍后再说</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  title: {
    marginTop: 20,
    color: colors.text,
    fontFamily,
    ...typography.detail,
    textAlign: 'center',
  },
  copy: {
    maxWidth: 300,
    marginTop: 10,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
    textAlign: 'center',
  },
  draftBox: {
    width: '100%',
    marginTop: 24,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  draftText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  actions: {
    width: '100%',
    marginTop: 28,
    gap: 10,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.background,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.7,
  },
});
