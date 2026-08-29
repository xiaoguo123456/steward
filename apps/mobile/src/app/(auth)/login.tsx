import { errorMessage, login, requestPhoneCode } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { session } from '@/api/session';
import { deviceTimezone } from '@/api/timezone-sync';
import { PrimaryButton } from '@/features/auth/components/auth-actions';
import { AuthInput, AuthShell } from '@/features/auth/components/auth-shell';
import {
  normalizePhoneInput,
  phoneValidationMessage,
  PHONE_PATTERN,
} from '@/features/auth/login-input';
import { resolvePhoneCodeDelivery } from '@/features/auth/phone-code';
import { openPublicPage } from '@/features/legal/open-public-page';
import { publicPagePaths } from '@/features/legal/public-pages';
import { colors, fontFamily, typography } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const phoneRef = useRef('');
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((current) => {
        if (current <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const phoneValid = PHONE_PATTERN.test(phone);
  const phoneError = phoneValidationMessage(phone, phoneTouched);
  const canRequestCode = agreementAccepted && phoneValid && cooldown === 0 && !sending && !submitting;
  const canSubmit = agreementAccepted && phoneValid && code.length === 6 && !sending && !submitting;

  const openLegalPage = async (path: typeof publicPagePaths.privacy | typeof publicPagePaths.terms) => {
    try {
      await openPublicPage(path);
    } catch {
      setError('暂时无法打开公开页面，手机号和勾选状态已为你保留，请稍后重试。');
    }
  };

  const handleSendCode = async () => {
    setPhoneTouched(true);
    if (!canRequestCode) return;
    const requestedPhone = phone;
    setError(null);
    setSending(true);
    try {
      const response = await requestPhoneCode({ phone: requestedPhone });
      // 请求期间若改了手机号，旧号码的验证码不能填进新号码表单。
      if (phoneRef.current !== requestedPhone) return;
      startCooldown(response.data.resend_after_seconds);
      const delivery = resolvePhoneCodeDelivery(response.data);
      setCode(delivery.code);
      setHint(delivery.hint);
      if (!delivery.code) codeInputRef.current?.focus();
    } catch (err) {
      setError(errorMessage(err, '验证码发送失败，请稍后重试。'));
    } finally {
      setSending(false);
    }
  };

  const handleLogin = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await login({
        phone,
        code,
        timezone: deviceTimezone(),
      });
      await session.signIn(response.data.tokens);
      router.replace('/today');
    } catch (err) {
      setError(errorMessage(err, '登录失败，请检查手机号与验证码。'));
      codeInputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell heading="欢迎回来" subtitle="手机号验证后即可继续">
      <AuthInput
        accessibilityLabel="手机号"
        autoComplete="tel"
        editable={!submitting}
        icon="phone-portrait-outline"
        importantForAutofill="yes"
        keyboardType="number-pad"
        maxLength={11}
        onBlur={() => setPhoneTouched(true)}
        onChangeText={(value) => {
          const normalized = normalizePhoneInput(value);
          phoneRef.current = normalized;
          setPhone(normalized);
          setCode('');
          setError(null);
          setHint(null);
        }}
        placeholder="请输入手机号"
        textContentType="telephoneNumber"
        value={phone}
      />
      {phoneError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {phoneError}
        </Text>
      ) : null}

      <View style={styles.agreementRow}>
        <Pressable
          accessibilityLabel={agreementAccepted ? '取消同意用户协议与隐私政策' : '同意用户协议与隐私政策'}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreementAccepted }}
          hitSlop={6}
          onPress={() => {
            setAgreementAccepted((current) => !current);
            setError(null);
          }}
          style={({ pressed }) => [
            styles.checkbox,
            agreementAccepted && styles.checkboxChecked,
            pressed && styles.checkboxPressed,
          ]}
        >
          {agreementAccepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </Pressable>
        <Text style={styles.agreementText}>
          我已阅读并同意
          <Text
            accessibilityRole="link"
            onPress={() => void openLegalPage(publicPagePaths.terms)}
            style={styles.agreementLink}
          >
            《用户协议》
          </Text>
          和
          <Text
            accessibilityRole="link"
            onPress={() => void openLegalPage(publicPagePaths.privacy)}
            style={styles.agreementLink}
          >
            《隐私政策》
          </Text>
        </Text>
      </View>
      {!agreementAccepted ? (
        <Text accessibilityLiveRegion="polite" style={styles.agreementHint}>
          勾选后才能获取验证码；手机号会在发送验证码时开始处理。
        </Text>
      ) : null}

      <View style={styles.codeRow}>
        <View style={styles.codeInput}>
          <AuthInput
            accessibilityLabel="短信验证码"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            containerStyle={styles.codeInputShell}
            editable={!submitting}
            icon="keypad-outline"
            importantForAutofill="yes"
            inputRef={codeInputRef}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, ''));
              setError(null);
            }}
            placeholder="6 位验证码"
            textContentType="oneTimeCode"
            value={code}
          />
        </View>
        <Pressable
          accessibilityHint={!agreementAccepted ? '请先阅读并同意用户协议与隐私政策' : undefined}
          accessibilityLabel={
            !agreementAccepted
              ? '获取验证码，当前不可用，请先同意协议'
              : cooldown > 0
                ? `${cooldown} 秒后可重新获取验证码`
                : '获取验证码'
          }
          accessibilityRole="button"
          accessibilityState={{
            busy: sending,
            disabled: !canRequestCode,
          }}
          disabled={!canRequestCode}
          onPress={handleSendCode}
          style={({ pressed }) => [
            styles.codeButton,
            !canRequestCode && styles.codeButtonDisabled,
            pressed && styles.codeButtonPressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.primaryStrong} size="small" />
          ) : (
            <Text style={styles.codeButtonText}>
              {cooldown > 0 ? `${cooldown}s` : '获取验证码'}
            </Text>
          )}
        </Pressable>
      </View>

      {error ? (
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!error && hint ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {hint}
        </Text>
      ) : null}

      <View style={styles.buttonWrap}>
        <PrimaryButton disabled={!canSubmit} onPress={handleLogin}>
          {submitting ? '登录中…' : '登录'}
        </PrimaryButton>
      </View>
      <Text style={styles.muted}>首次登录将自动创建账号</Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  agreementRow: {
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 24,
    height: 24,
    marginRight: 9,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxChecked: {
    borderColor: colors.primaryStrong,
    backgroundColor: colors.primaryStrong,
  },
  checkboxPressed: {
    opacity: 0.68,
  },
  checkboxMark: {
    color: colors.background,
    fontFamily,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
  },
  agreementText: {
    minWidth: 0,
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    lineHeight: 22,
  },
  agreementLink: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  agreementHint: {
    marginBottom: 12,
    marginLeft: 33,
    color: colors.textTertiary,
    fontFamily,
    ...typography.caption,
  },
  codeRow: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  codeInput: {
    flex: 1,
  },
  codeInputShell: {
    marginBottom: 0,
  },
  codeButton: {
    minWidth: 96,
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  codeButtonDisabled: {
    backgroundColor: colors.surface,
  },
  codeButtonPressed: {
    opacity: 0.7,
  },
  codeButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonWrap: {
    marginTop: 18,
  },
  error: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  hint: {
    marginTop: 12,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
  },
  fieldError: {
    marginTop: -8,
    marginBottom: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  muted: {
    marginTop: 16,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
});
