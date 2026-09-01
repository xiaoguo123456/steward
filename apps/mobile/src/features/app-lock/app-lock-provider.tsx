import * as LocalAuthentication from 'expo-local-authentication';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator, AppState, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { session } from '@/api/session';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, spacing, typography } from '@/theme/tokens';

import { readAppLockEnabled, writeAppLockEnabled } from './app-lock-storage';
import { authenticationFailureMessage, shouldShieldApp } from './model';

type Availability = 'checking' | 'available' | 'not-enrolled' | 'unsupported';

type AppLockContextValue = {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  availability: Availability;
  authenticationLabel: string;
  failure: string | null;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  retry: () => Promise<void>;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);

type Snapshot = {
  accountId: string | null;
  ready: boolean;
  enabled: boolean;
  locked: boolean;
  authenticating: boolean;
  availability: Availability;
  authenticationLabel: string;
  failure: string | null;
};

const initialSnapshot: Snapshot = {
  accountId: null,
  ready: false,
  enabled: false,
  locked: true,
  authenticating: false,
  availability: 'checking',
  authenticationLabel: '系统身份验证',
  failure: null,
};

export function AppLockProvider({
  active,
  children,
}: PropsWithChildren<{ active: boolean }>) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const accountId = active ? session.userId() : null;
  const accountIdRef = useRef<string | null>(accountId);
  const enabledRef = useRef(false);
  const authenticationRef = useRef<Promise<LocalAuthentication.LocalAuthenticationResult> | null>(
    null,
  );

  useEffect(() => {
    accountIdRef.current = accountId;
  }, [accountId]);

  const authenticate = useCallback((promptMessage: string) => {
    if (authenticationRef.current) return authenticationRef.current;

    setSnapshot((current) => ({ ...current, authenticating: true, failure: null }));
    const request = LocalAuthentication.authenticateAsync({
      promptMessage,
      promptSubtitle: '验证后才能查看私人内容',
      cancelLabel: '取消',
      fallbackLabel: '使用设备密码',
      disableDeviceFallback: false,
      requireConfirmation: true,
      biometricsSecurityLevel: 'strong',
    }).catch((): LocalAuthentication.LocalAuthenticationResult => ({
      success: false,
      error: 'not_available',
    }));
    authenticationRef.current = request;
    void request.finally(() => {
      if (authenticationRef.current === request) authenticationRef.current = null;
      setSnapshot((current) => ({ ...current, authenticating: false }));
    });
    return request;
  }, []);

  const unlock = useCallback(async () => {
    const sourceAccountId = accountIdRef.current;
    if (!sourceAccountId || !enabledRef.current) return;

    const result = await authenticate('解锁 AI 事管家');
    if (accountIdRef.current !== sourceAccountId || !enabledRef.current) return;
    if (result.success) {
      setSnapshot((current) => ({ ...current, locked: false, failure: null }));
      return;
    }
    setSnapshot((current) => ({
      ...current,
      locked: true,
      failure: authenticationFailureMessage(result.error),
    }));
  }, [authenticate]);

  useEffect(() => {
    let cancelled = false;
    // 放入微任务，避免在 Effect 主体中同步级联渲染；首帧由 accountId 不匹配直接遮挡。
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (!accountId) {
        enabledRef.current = false;
        setSnapshot({
          ...initialSnapshot,
          accountId: null,
          ready: true,
          locked: false,
          availability: 'unsupported',
        });
        return;
      }
      setSnapshot({ ...initialSnapshot, accountId });
      return Promise.all([readAppLockEnabled(accountId), detectAvailability()]).then(
        ([enabled, availability]) => {
          if (cancelled || accountIdRef.current !== accountId) return;
          enabledRef.current = enabled;
          setSnapshot({
            accountId,
            ready: true,
            enabled,
            locked: enabled,
            authenticating: false,
            availability: availability.status,
            authenticationLabel: availability.label,
            failure: null,
          });
          if (enabled && AppState.currentState === 'active') void unlock();
        },
        () => {
          if (cancelled || accountIdRef.current !== accountId) return;
          // 无法确认本地偏好时按“已开启”处理，避免存储故障意外暴露私人内容。
          enabledRef.current = true;
          setSnapshot({
            ...initialSnapshot,
            accountId,
            ready: true,
            enabled: true,
            locked: true,
            availability: 'unsupported',
            failure: '设备保护设置暂时无法读取。',
          });
        },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!enabledRef.current) return;
      if (state === 'active') {
        void unlock();
      } else {
        // 在系统生成任务切换预览前立即换成不含私人正文的遮罩。
        setSnapshot((current) => ({ ...current, locked: true, failure: null }));
      }
    });
    return () => subscription.remove();
  }, [unlock]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean): Promise<boolean> => {
      const sourceAccountId = accountIdRef.current;
      if (!sourceAccountId) return false;
      if (nextEnabled && snapshot.availability !== 'available') {
        setSnapshot((current) => ({
          ...current,
          failure: availabilityMessage(current.availability),
        }));
        return false;
      }

      const result = await authenticate(nextEnabled ? '开启应用锁' : '关闭应用锁');
      if (accountIdRef.current !== sourceAccountId) return false;
      if (!result.success) {
        setSnapshot((current) => ({
          ...current,
          locked: current.enabled,
          failure: authenticationFailureMessage(result.error),
        }));
        return false;
      }

      try {
        await writeAppLockEnabled(sourceAccountId, nextEnabled);
      } catch {
        setSnapshot((current) => ({
          ...current,
          locked: current.enabled,
          failure: '应用锁设置没能保存，请重试。',
        }));
        return false;
      }

      enabledRef.current = nextEnabled;
      setSnapshot((current) => ({
        ...current,
        enabled: nextEnabled,
        locked: false,
        failure: null,
      }));
      return true;
    },
    [authenticate, snapshot.availability],
  );

  const value = useMemo<AppLockContextValue>(
    () => ({
      enabled: snapshot.enabled,
      ready: snapshot.ready,
      busy: snapshot.authenticating,
      availability: snapshot.availability,
      authenticationLabel: snapshot.authenticationLabel,
      failure: snapshot.failure,
      enable: () => setEnabled(true),
      disable: () => setEnabled(false),
      retry: unlock,
    }),
    [setEnabled, snapshot, unlock],
  );

  const shielded =
    active &&
    (snapshot.accountId !== accountId || shouldShieldApp({ active, ...snapshot }));
  const curtainSnapshot = snapshot.accountId === accountId
    ? snapshot
    : { ...initialSnapshot, accountId };
  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {shielded ? <LockCurtain snapshot={curtainSnapshot} onRetry={unlock} /> : null}
      </View>
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockContextValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock 必须在 AppLockProvider 内使用');
  return value;
}

async function detectAvailability(): Promise<{
  status: Availability;
  label: string;
}> {
  if (Platform.OS === 'web') return { status: 'unsupported', label: '原生设备身份验证' };
  try {
    const [hasHardware, securityLevel, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    // 没有生物识别硬件但已设置设备 PIN／密码时，系统凭据仍可形成有效安全边界。
    if (securityLevel === LocalAuthentication.SecurityLevel.NONE) {
      return {
        status: hasHardware ? 'not-enrolled' : 'unsupported',
        label: '系统身份验证',
      };
    }
    const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? '面容识别或设备密码'
      : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ? '指纹或设备密码'
        : '生物识别或设备密码';
    return { status: 'available', label };
  } catch {
    return { status: 'unsupported', label: '系统身份验证' };
  }
}

function availabilityMessage(availability: Availability): string {
  if (Platform.OS === 'web') return '应用锁仅支持 iOS 和 Android 原生应用。';
  if (availability === 'not-enrolled') {
    return '请先在系统设置中录入面容、指纹或设置设备密码。';
  }
  return '当前设备不支持可用的系统身份验证。';
}

function LockCurtain({ snapshot, onRetry }: { snapshot: Snapshot; onRetry: () => Promise<void> }) {
  return (
    <Modal
      animationType="none"
      onRequestClose={() => undefined}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible
    >
      <View
        accessibilityLabel="应用已锁定"
        accessibilityViewIsModal
        importantForAccessibility="yes"
        style={styles.curtain}
      >
        <View style={styles.lockIcon}>
          <AppIcon color={colors.primaryStrong} name="lock-closed-outline" size={28} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {snapshot.ready ? 'AI 事管家已锁定' : '正在检查设备保护'}
        </Text>
        <Text style={styles.message}>
          {snapshot.failure ??
            (snapshot.ready
              ? `使用${snapshot.authenticationLabel}查看内容。`
              : '私人内容会在确认完成前保持隐藏。')}
        </Text>
        {snapshot.authenticating || !snapshot.ready ? (
          <View style={styles.progress}>
            <ActivityIndicator color={colors.primaryStrong} />
            <Text style={styles.progressText}>正在验证…</Text>
          </View>
        ) : (
          <AppButton
            accessibilityLabel="重新验证并解锁"
            label="重新验证"
            onPress={() => void onRetry()}
            style={styles.unlockButton}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  curtain: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  lockIcon: {
    width: 56,
    height: 56,
    marginBottom: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
  },
  title: { color: colors.text, fontFamily, ...typography.detail, textAlign: 'center' },
  message: {
    maxWidth: 300,
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
    textAlign: 'center',
  },
  progress: {
    minHeight: 52,
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: { color: colors.textSecondary, fontFamily, ...typography.label },
  unlockButton: { minWidth: 160, marginTop: spacing.xl },
});
